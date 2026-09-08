import json
import os
from urllib.request import Request, urlopen

from flask import jsonify, request

try:
    import stripe
except ImportError:  # pragma: no cover
    stripe = None


def _env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# Paid AI is completely disabled unless PAID_AI_ENABLED is explicitly true.
PAID_AI_ENABLED = _env_bool("PAID_AI_ENABLED", False)
PAID_AI_PACK_USES = 50
PAID_AI_PACK_PRICE_PENCE = 499
PAID_AI_CURRENCY = "gbp"

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
PAID_AI_FUNCTION_URL = os.environ.get("PAID_AI_FUNCTION_URL")
PAID_AI_FUNCTION_SECRET = os.environ.get("PAID_AI_FUNCTION_SECRET")

stripe_client = stripe if stripe and STRIPE_SECRET_KEY else None
if stripe_client:
    stripe_client.api_key = STRIPE_SECRET_KEY


def _paid_ai_function(action, payload):
    if not PAID_AI_ENABLED or not PAID_AI_FUNCTION_URL or not PAID_AI_FUNCTION_SECRET:
        return None
    body = json.dumps({"action": action, **payload}).encode("utf-8")
    req = Request(
        PAID_AI_FUNCTION_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {PAID_AI_FUNCTION_SECRET}",
        },
    )
    try:
        with urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:
        print("Paid AI function request failed:", repr(error))
        return None


def get_paid_uses(visitor_id, base_supabase):
    """Return purchased AI uses through the Supabase Edge Function."""
    result = _paid_ai_function("get", {"visitor_id": visitor_id})
    if not result:
        return 0
    try:
        return max(0, int(result.get("uses", 0) or 0))
    except (TypeError, ValueError):
        return 0


def register_paid_ai(app, base_supabase, visitor_id_func):
    """Register Stripe Checkout/webhook routes and connect paid uses to AI limits."""
    import sys

    server_module = sys.modules.get("server") or sys.modules.get("__main__")
    if server_module is not None and not getattr(server_module, "_paid_ai_usage_wrapped", False):
        original_get_ai_usage = server_module.get_ai_usage

        def get_ai_usage_with_paid(visitor_id):
            used, infinite = original_get_ai_usage(visitor_id)
            if infinite or not PAID_AI_ENABLED:
                return used, infinite
            paid_uses = get_paid_uses(visitor_id, base_supabase)
            # Keep purchased uses as negative effective usage until they are consumed.
            # This makes the existing AI_MAX_USES limit naturally become
            # AI_MAX_USES + purchased uses.
            return used - paid_uses, False

        server_module.get_ai_usage = get_ai_usage_with_paid
        server_module._paid_ai_usage_wrapped = True

    @app.get("/api/ai/paid/config")
    def paid_ai_config():
        configured = bool(stripe_client and PAID_AI_FUNCTION_URL and PAID_AI_FUNCTION_SECRET)
        return jsonify({
            "enabled": PAID_AI_ENABLED and configured,
            "uses": PAID_AI_PACK_USES,
            "price_pence": PAID_AI_PACK_PRICE_PENCE,
            "currency": PAID_AI_CURRENCY,
        })

    @app.post("/api/ai/paid/checkout")
    def create_paid_ai_checkout():
        if not PAID_AI_ENABLED:
            return jsonify({"error": "Paid AI uses are currently disabled."}), 403
        if stripe_client is None:
            return jsonify({"error": "Stripe payments are not configured on the server."}), 503
        if not PAID_AI_FUNCTION_URL or not PAID_AI_FUNCTION_SECRET:
            return jsonify({"error": "Paid AI storage is not configured on the server."}), 503

        try:
            visitor_id = visitor_id_func()
            origin = request.host_url.rstrip("/")
            session = stripe_client.checkout.Session.create(
                mode="payment",
                line_items=[{
                    "price_data": {
                        "currency": PAID_AI_CURRENCY,
                        "product_data": {"name": f"{PAID_AI_PACK_USES} Woocorp AI uses"},
                        "unit_amount": PAID_AI_PACK_PRICE_PENCE,
                    },
                    "quantity": 1,
                }],
                client_reference_id=visitor_id,
                metadata={
                    "visitor_id": visitor_id,
                    "ai_uses": str(PAID_AI_PACK_USES),
                },
                success_url=f"{origin}/?ai_payment=success",
                cancel_url=f"{origin}/?ai_payment=cancelled",
            )
            return jsonify({"url": session.url})
        except Exception as error:
            print("Stripe Checkout creation failed:", repr(error))
            return jsonify({"error": "Could not start the AI-use payment."}), 502

    @app.post("/api/stripe/webhook")
    def stripe_webhook():
        if not PAID_AI_ENABLED:
            return jsonify({"received": True})
        if stripe_client is None or not STRIPE_WEBHOOK_SECRET:
            return jsonify({"error": "Stripe webhook is not configured."}), 503

        payload = request.data
        signature = request.headers.get("Stripe-Signature", "")
        try:
            event = stripe_client.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
        except ValueError:
            return jsonify({"error": "Invalid Stripe payload."}), 400
        except stripe.error.SignatureVerificationError:
            return jsonify({"error": "Invalid Stripe signature."}), 400

        if event["type"] == "checkout.session.completed":
            session = event["data"]["object"]
            if session.get("payment_status") != "paid":
                return jsonify({"received": True})

            metadata = session.get("metadata") or {}
            visitor_id = str(metadata.get("visitor_id", "")).strip()
            uses = int(metadata.get("ai_uses", "0") or 0)
            amount = int(session.get("amount_total") or 0)
            currency = str(session.get("currency") or PAID_AI_CURRENCY).lower()

            if (
                not visitor_id
                or uses != PAID_AI_PACK_USES
                or amount != PAID_AI_PACK_PRICE_PENCE
                or currency != PAID_AI_CURRENCY
            ):
                print("Rejected Stripe AI purchase with unexpected metadata/amount:", session.get("id"))
                return jsonify({"error": "Invalid purchase details."}), 400

            recorded = _paid_ai_function("record", {
                "stripe_session_id": session["id"],
                "visitor_id": visitor_id,
                "uses": uses,
                "amount_paid": amount,
                "currency": currency,
            })
            if not recorded or not recorded.get("ok"):
                return jsonify({"error": "Could not record the purchase."}), 500

        return jsonify({"received": True}), 200

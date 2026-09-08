import os

from flask import jsonify, redirect, request
from supabase import create_client

try:
    import stripe
except ImportError:  # pragma: no cover
    stripe = None


PAID_AI_ENABLED = True
PAID_AI_PACK_USES = 10
PAID_AI_PACK_PRICE_PENCE = 399
PAID_AI_CURRENCY = "gbp"

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

stripe_client = stripe if stripe and STRIPE_SECRET_KEY else None
if stripe_client:
    stripe_client.api_key = STRIPE_SECRET_KEY


def _admin_supabase(base_supabase):
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    url = os.environ.get("SUPABASE_URL")
    if not url:
        return None
    return create_client(url, SUPABASE_SERVICE_ROLE_KEY)


def get_paid_uses(visitor_id, base_supabase):
    """Return the number of purchased AI uses for this visitor.

    The purchase total is intentionally not decremented. The existing AI usage
    counter is cumulative, so subtracting purchased uses from that counter gives
    exactly the purchased allowance without creating a client-controlled balance.
    """
    admin = _admin_supabase(base_supabase)
    if admin is None:
        return 0
    try:
        result = (
            admin.table("ai_paid_purchases")
            .select("uses")
            .eq("visitor_id", visitor_id)
            .execute()
        )
        return sum(int(row.get("uses", 0) or 0) for row in (result.data or []))
    except Exception as error:
        print("Paid AI usage lookup failed:", repr(error))
        return 0


def register_paid_ai(app, base_supabase, visitor_id_func):
    """Register Stripe Checkout/webhook routes and connect paid uses to AI limits."""
    import sys

    # server.py is already executing when this function is called. Use the
    # existing module object so local `python server.py` does not import a second
    # copy of the application module.
    server_module = sys.modules.get("server") or sys.modules.get("__main__")
    if server_module is not None and not getattr(server_module, "_paid_ai_usage_wrapped", False):
        original_get_ai_usage = server_module.get_ai_usage

        def get_ai_usage_with_paid(visitor_id):
            used, infinite = original_get_ai_usage(visitor_id)
            if infinite or not PAID_AI_ENABLED:
                return used, infinite
            paid_uses = get_paid_uses(visitor_id, base_supabase)
            return max(0, used - paid_uses), False

        server_module.get_ai_usage = get_ai_usage_with_paid
        server_module._paid_ai_usage_wrapped = True

    @app.get("/api/ai/paid/config")
    def paid_ai_config():
        # The frontend button is controlled by PAID_AI_ENABLED, as intended.
        # Missing server configuration is reported when checkout is attempted,
        # rather than silently hiding the button.
        return jsonify({
            "enabled": PAID_AI_ENABLED,
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
        if SUPABASE_SERVICE_ROLE_KEY is None:
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

            admin = _admin_supabase(base_supabase)
            if admin is None:
                return jsonify({"error": "Supabase service role is not configured."}), 503

            try:
                admin.table("ai_paid_purchases").insert({
                    "stripe_session_id": session["id"],
                    "visitor_id": visitor_id,
                    "uses": uses,
                    "amount_paid": amount,
                    "currency": currency,
                }).execute()
            except Exception as error:
                # Stripe may retry a webhook. A unique session ID makes retries
                # harmless; report the error but acknowledge an already-recorded
                # purchase rather than granting it twice.
                message = str(error).lower()
                if "duplicate" not in message and "unique" not in message:
                    print("Could not record paid AI purchase:", repr(error))
                    return jsonify({"error": "Could not record the purchase."}), 500

        return jsonify({"received": True}), 200

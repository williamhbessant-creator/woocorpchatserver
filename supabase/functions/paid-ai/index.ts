import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const functionSecret = Deno.env.get("PAID_AI_FUNCTION_SECRET")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const auth = req.headers.get("Authorization") || "";
  if (auth !== `Bearer ${functionSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();

    if (body.action === "get") {
      const visitorId = String(body.visitor_id || "").trim();
      if (!visitorId) {
        return new Response(JSON.stringify({ error: "Missing visitor_id" }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const { data, error } = await supabase
        .from("ai_paid_purchases")
        .select("uses")
        .eq("visitor_id", visitorId);

      if (error) throw error;

      const uses = (data || []).reduce(
        (total, row) => total + Number(row.uses || 0),
        0,
      );
      return new Response(JSON.stringify({ uses }), { headers: corsHeaders });
    }

    if (body.action === "record") {
      const stripeSessionId = String(body.stripe_session_id || "").trim();
      const visitorId = String(body.visitor_id || "").trim();
      const uses = Number(body.uses || 0);
      const amountPaid = Number(body.amount_paid || 0);
      const currency = String(body.currency || "gbp").toLowerCase();

      if (!stripeSessionId || !visitorId || uses !== 50 || amountPaid !== 499 || currency !== "gbp") {
        return new Response(JSON.stringify({ error: "Invalid purchase details" }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const { error } = await supabase.from("ai_paid_purchases").insert({
        stripe_session_id: stripeSessionId,
        visitor_id: visitorId,
        uses,
        amount_paid: amountPaid,
        currency,
      });

      if (error) {
        const message = String(error.message || "").toLowerCase();
        if (message.includes("duplicate") || message.includes("unique")) {
          return new Response(JSON.stringify({ ok: true, duplicate: true }), {
            headers: corsHeaders,
          });
        }
        throw error;
      }

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

// supabase/functions/customer-assistant/index.ts
// Public shop assistant. See logic.ts for how its answers are restricted.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCors, jsonResponse, errorResponse } from "../shared/cors.ts";
import { loadAISettings, runAI } from "../shared/ai-runner.ts";
import { acceptModelReply, AssistantContext, buildModelPrompt, decide, OFF_TOPIC_REPLY } from "./logic.ts";

async function visitorKey(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest).slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { slug, message, pendingProductId } = await req.json().catch(() => ({}));
    const text = typeof message === "string" ? message.trim() : "";
    if (!text || text.length > 500) {
      return errorResponse("Please keep your question under 500 characters.", 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, name, currency, address, contact_phone, default_payment_methods")
      .eq("website_slug", String(slug ?? ""))
      .is("deleted_at", null)
      .maybeSingle();
    if (businessError) throw businessError;
    if (!business) return errorResponse("This shop is not available.", 404);

    const { data: settings, error: settingsError } = await admin
      .from("website_settings")
      .select("delivery_enabled, delivery_fee, assistant_enabled")
      .eq("business_id", business.id)
      .maybeSingle();
    if (settingsError) throw settingsError;
    if (settings?.assistant_enabled === false) {
      return errorResponse("The assistant is not available right now.", 403, "ASSISTANT_DISABLED");
    }

    const { data: allowed, error: quotaError } = await admin.rpc("consume_assistant_quota", {
      p_business_id: business.id,
      p_visitor: await visitorKey(req),
    });
    if (quotaError) throw quotaError;
    if (!allowed) {
      return errorResponse("You've asked a lot of questions. Please try again in a little while.", 429);
    }

    const [productResult, articleResult] = await Promise.all([
      admin
        .from("products")
        .select("id, name, category, price, unit, stock")
        .eq("business_id", business.id)
        .eq("show_on_website", true)
        .gt("price", 0)
        .is("deleted_at", null),
      admin
        .from("website_articles")
        .select("slug, title, summary, body")
        .eq("business_id", business.id)
        .eq("published", true),
    ]);

    if (productResult.error) throw productResult.error;
    if (articleResult.error) throw articleResult.error;
    const products = productResult.data;
    const articles = articleResult.data;

    const ctx: AssistantContext = {
      businessName: business.name,
      currency: business.currency,
      deliveryEnabled: settings?.delivery_enabled ?? true,
      deliveryFee: Number(settings?.delivery_fee ?? 150),
      paymentMethods: business.default_payment_methods ?? [],
      address: business.address,
      phone: business.contact_phone || null,
      products: (products ?? []).map((p: any) => ({ ...p, price: Number(p.price), stock: Number(p.stock) })),
      articles: articles ?? [],
    };

    const result = decide(text, typeof pendingProductId === "string" ? pendingProductId : null, ctx);
    if (!result.needsModel) {
      const { needsModel: _ignored, ...reply } = result;
      return jsonResponse(reply);
    }

    // The model gets the prompt and the customer's text, and nothing from the stock query.
    let reply = OFF_TOPIC_REPLY;
    const ai = await runAI(await loadAISettings(business.id), {
      systemInstruction: buildModelPrompt(ctx),
      messages: [{ role: "user", content: text }],
      responseMimeType: "application/json",
    }).catch(() => null);
    if (ai?.success) reply = acceptModelReply(ai.text);

    return jsonResponse({ reply, pendingProductId: null });
  } catch (err: any) {
    console.error("[customer-assistant]", err);
    return errorResponse("The assistant is having trouble. Please try again.", 500);
  }
});

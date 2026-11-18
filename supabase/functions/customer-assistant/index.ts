// supabase/functions/customer-assistant/index.ts
// Public shop assistant. Runs on the AI the owner chose in the app (Settings → AI); see
// logic.ts for which answers stay rule-based and how the AI's replies are checked.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCors, jsonResponse, errorResponse, clientIp } from "../shared/cors.ts";
import { loadAISettings, runAI } from "../shared/ai-runner.ts";
import { acceptModelReply, AssistantContext, buildModelPrompt, decide } from "./logic.ts";

async function visitorKey(req: Request): Promise<string> {
  const ip = clientIp(req);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest).slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { slug, message, pendingProductId, history } = await req.json().catch(() => ({}));
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
      .select("*") // "*" so a column a newer migration adds (opening_hours) is optional
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

    const [productResult, articleResult, zoneResult, cardsResult, airtelResult] = await Promise.all([
      admin
        .from("products")
        .select("id, name, category, price, unit, stock, min_stock")
        .eq("business_id", business.id)
        .eq("show_on_website", true)
        .gt("price", 0)
        .is("deleted_at", null),
      admin
        .from("website_articles")
        .select("slug, title, summary, body")
        .eq("business_id", business.id)
        .eq("published", true),
      admin.from("delivery_zones").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("active", true),
      admin.rpc("website_accepts_cards", { p_slug: String(slug ?? "") }),
      admin.rpc("website_accepts_airtel", { p_slug: String(slug ?? "") }),
    ]);

    if (productResult.error) throw productResult.error;
    if (articleResult.error) throw articleResult.error;
    const products = productResult.data;
    const articles = articleResult.data;

    const ctx: AssistantContext = {
      assistantName: Deno.env.get("VITE_AI_NAME") || "Kim",
      businessName: business.name,
      currency: business.currency,
      deliveryEnabled: settings?.delivery_enabled ?? true,
      deliveryFee: Number(settings?.delivery_fee ?? 0),
      deliveryByArea: (zoneResult.count ?? 0) > 0,
      payOnline: ["M-Pesa", ...(airtelResult.data === true ? ["Airtel Money"] : []), ...(cardsResult.data === true ? ["card"] : [])],
      paymentMethods: business.default_payment_methods ?? [],
      address: business.address,
      phone: business.contact_phone || null,
      openingHours: (settings as any)?.opening_hours?.trim() || null,
      products: (products ?? []).map((p: any) => ({
        id: p.id, name: p.name, category: p.category, unit: p.unit,
        price: Number(p.price), stock: Number(p.stock), minStock: Number(p.min_stock ?? 0),
      })),
      articles: articles ?? [],
    };

    const { needsModel, ...decided } = decide(text, typeof pendingProductId === "string" ? pendingProductId : null, ctx);
    if (!needsModel) return jsonResponse(decided);

    // The model gets the shop's public facts (prices and availability, never stock counts)
    // and the last few turns of this chat. If it is down, refuses, or says something we
    // won't pass on, the customer gets the answer `decide` prepared instead of an error.
    const ai = await runAI(await loadAISettings(business.id), {
      systemInstruction: buildModelPrompt(ctx, decided.reply),
      messages: [...recentTurns(history), { role: "user", content: text }],
      responseMimeType: "application/json",
    }).catch(() => null);
    const modelReply = ai?.success ? acceptModelReply(ai.text, ctx) : null;
    if (!ai?.success) console.warn("[customer-assistant] model unavailable:", ai?.code ?? "error");

    return jsonResponse(modelReply ? { ...decided, reply: modelReply } : decided);
  } catch (err: any) {
    console.error("[customer-assistant]", err);
    return errorResponse("The assistant is having trouble. Please try again.", 500);
  }
});

/** The chat so far, as the page sent it: the last 8 turns, each cut short. Text only. */
function recentTurns(history: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-8)
    .filter((m: any) => (m?.from === "customer" || m?.from === "assistant") && typeof m?.text === "string" && m.text.trim())
    .map((m: any) => ({ role: m.from === "customer" ? "user" as const : "assistant" as const, content: m.text.slice(0, 500) }));
}

// Customer feedback insights: one AI summary of a business's open feedback (Feedback screen,
// "Insights"). Replies and single-comment notes go through the chat function instead.
//
// The feedback is read from the database with the caller's own session, so row security decides
// what is included and the request cannot add made-up reviews. When AI is off or fails, the reply
// says so (success: false). It never returns sample figures, because staff would read them as
// their customers' views.

// deno-lint-ignore-file no-explicit-any
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
  enforceRateLimit,
  createUserClient,
} from "../shared/cors.ts";
import { loadAISettings, runAI } from "../shared/ai-runner.ts";

/** Most recent open feedback sent to the AI; keeps the prompt (and its cost) bounded. */
const MAX_COMMENTS = 200;
const MAX_COMMENT_CHARS = 600;

function parseJson(raw: string): any {
  let cleaned = (raw || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(json)?\s*/, "").replace(/```$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

const unavailable = () =>
  jsonResponse({ success: false, error: "AI insights are not available right now." });

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON payload", 400);
    }
    const { action, businessId } = body ?? {};
    if (!businessId) return errorResponse("businessId is required.", 400);

    const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    const forbidden = await requirePermission(req, businessId, "complaints.view");
    if (forbidden) return forbidden;

    if (action !== "analytics") return errorResponse(`Unsupported action: "${action}"`, 400);

    // Per person and per business, because every AI call costs the business money.
    const limited =
      (await enforceRateLimit(`ai:user:${userId}`, 20, 60)) ||
      (await enforceRateLimit(`ai:biz:${businessId}`, 500, 86400));
    if (limited) return limited;

    const settings = await loadAISettings(businessId, "messages");
    if (!settings) return unavailable();

    const db = createUserClient(req);
    const [{ data: biz }, { data: rows, error }] = await Promise.all([
      db.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      db.from("complaints")
        .select("rating, comment, sentiment, branch")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("timestamp", { ascending: false })
        .limit(MAX_COMMENTS),
    ]);
    if (error) {
      console.error("[complaints] Could not read feedback:", error.code);
      return errorResponse("Could not read the feedback. Please try again.", 500);
    }

    const comments = rows ?? [];
    if (comments.length === 0) {
      return jsonResponse({
        success: true,
        analytics: { overallSummary: "There is no open feedback to look at yet.", categories: [], recurringProblems: [], operationalImprovements: [] },
      });
    }

    const bizName = biz?.name || "the business";
    const formatted = comments
      .map((c: any) =>
        `[Rating: ${c.rating}/5 | Sentiment: ${c.sentiment || "unknown"} | Branch: ${c.branch || "N/A"}] "${String(c.comment || "").slice(0, MAX_COMMENT_CHARS)}"`
      )
      .join("\n");

    const prompt = `Analyse these ${comments.length} customer reviews for ${bizName}, a business in Kenya:

${formatted}

Provide:
1. A short summary of overall sentiment
2. The feedback grouped into categories (for example Packaging, Delivery, Payments, Product quality, Service) with counts and percentages
3. Problems that come up more than once
4. Practical changes the business could make

Use only what the reviews say. Output raw JSON only.`;

    const result = await runAI(settings, {
      systemInstruction:
        `You review customer feedback for ${bizName} and point out patterns and practical fixes. Return raw JSON only, no markdown fences.`,
      messages: [{ role: "user", content: prompt }],
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          overallSummary: { type: "string" },
          categories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                count: { type: "integer" },
                percentage: { type: "integer" },
              },
              required: ["category", "count", "percentage"],
            },
          },
          recurringProblems: { type: "array", items: { type: "string" } },
          operationalImprovements: { type: "array", items: { type: "string" } },
        },
        required: ["overallSummary", "categories", "recurringProblems", "operationalImprovements"],
      },
    });
    if (!result.success) return unavailable();

    const analytics = parseJson(result.text);
    if (!analytics || typeof analytics.overallSummary !== "string") return unavailable();
    return jsonResponse({ success: true, analytics });
  } catch (err: any) {
    console.error("[complaints] Error:", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});

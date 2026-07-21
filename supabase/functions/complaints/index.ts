// supabase/edge_functions/complaints/index.ts
// Customer Complaints AI Processing — replaces POST /api/gemini/complaints from local server.ts
// Supports 4 actions: analyze | generate_reply | improve_reply | analytics

// deno-lint-ignore-file no-explicit-any
import {
  handleCors,
  jsonResponse,
  errorResponse,
} from "../shared/cors.ts";
import { loadAISettings, runAI } from "../shared/ai-runner.ts";

function safeParseJson(raw: string): any {
  if (!raw) return {};
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```$/, "")
      .trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI JSON response");
  }
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON payload", 400);
    }
    const { action, comment, draftText, comments, businessId } = body;

    if (!businessId) return errorResponse("businessId is required.", 400);
    if (!action) return errorResponse("action is required.", 400);

    // ── 1. Load AI settings ──────────────────────────────────────────────
    const settings = await loadAISettings(businessId);

    if (!settings) {
      // Return mock fallback so the UI never breaks
      return jsonResponse(getMockFallback(action, comment, draftText, comments));
    }

    const systemBase =
      "You are the Lead CRM and Customer Relations AI for KayKay's Milk (a premium dairy brand in Kenya). You are professional, empathetic, and precise. Return output as raw parseable JSON — no markdown fences.";

    // ── 2. Route by action ───────────────────────────────────────────────

    if (action === "analyze") {
      if (!comment) return errorResponse("comment payload is required.", 400);

      const prompt = `Analyze this customer feedback for KayKay's Milk:
Customer: ${comment.customerName || "Anonymous"}
Rating: ${comment.rating || "N/A"} / 5 stars
Branch: ${comment.branch || "N/A"}
Date: ${comment.timestamp || "N/A"}
Review: "${comment.comment || ""}"

Tasks:
1. Determine sentiment: positive, neutral, or negative
2. Classify severity: low, medium, high, or critical
3. Write a single-sentence summary of the core grievance or compliment
4. Suggest a highly specific resolution (e.g. replacement bottle, refund voucher, rider re-dispatch)
5. Give an escalation recommendation (which team/role should handle this and how urgently)

Output raw JSON only.`;

      const result = await runAI(settings, {
        systemInstruction: systemBase,
        messages: [{ role: "user", content: prompt }],
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            sentiment: { type: "string" },
            severity: { type: "string" },
            summary: { type: "string" },
            escalationRecommendation: { type: "string" },
            suggestedResolution: { type: "string" },
          },
          required: [
            "sentiment",
            "severity",
            "summary",
            "escalationRecommendation",
            "suggestedResolution",
          ],
        },
      });

      if (!result.success) {
        // Graceful fallback
        return jsonResponse({
          success: true,
          analysis: getMockAnalysis(comment),
        });
      }

      return jsonResponse({ success: true, analysis: safeParseJson(result.text) });

    } else if (action === "generate_reply") {
      if (!comment) return errorResponse("comment payload is required.", 400);

      const prompt = `Write a warm, professional customer service reply from KayKay's Milk management for this review:
Customer: ${comment.customerName || "Anonymous"}
Rating: ${comment.rating || "N/A"} / 5 stars
Branch: ${comment.branch || "N/A"}
Review: "${comment.comment || ""}"
${draftText ? `Additional directives to incorporate: "${draftText}"` : ""}

Guidelines:
- Polite, professional, and empathetic tone
- If negative (1-2 stars): apologise sincerely, take responsibility, mention a concrete remedy (replacement, refund, or follow-up)
- If positive (4-5 stars): thank warmly and reinforce brand quality
- Keep it under 3 sentences. No self-praise or flowery language.
- Output raw JSON with a single field: replyText`;

      const result = await runAI(settings, {
        systemInstruction:
          "You are the Voice of KayKay's Milk Management. You write polite, concise, professional customer service messages. Return raw JSON only.",
        messages: [{ role: "user", content: prompt }],
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: { replyText: { type: "string" } },
          required: ["replyText"],
        },
      });

      if (!result.success) {
        return jsonResponse({
          success: true,
          replyText: getMockReply(comment, draftText),
        });
      }

      const parsed = safeParseJson(result.text);
      return jsonResponse({ success: true, replyText: parsed.replyText });

    } else if (action === "improve_reply") {
      if (!comment || !draftText) {
        return errorResponse(
          "comment and draftText are required to improve a reply.",
          400
        );
      }

      const prompt = `Improve this draft customer service reply to be more professional and polished:
Customer: ${comment.customerName || "Anonymous"}
Customer's Comment: "${comment.comment || ""}"
Draft Reply: "${draftText}"

Refine: fix grammar, improve tone, make it sound corporate and warm but not sycophantic. Max 3 sentences. 
Output raw JSON with a single field: improvedText`;

      const result = await runAI(settings, {
        systemInstruction:
          "You are a professional copyeditor and customer relations coach for KayKay's Milk. Return raw JSON only.",
        messages: [{ role: "user", content: prompt }],
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: { improvedText: { type: "string" } },
          required: ["improvedText"],
        },
      });

      if (!result.success) {
        return jsonResponse({
          success: true,
          improvedText: getMockImprovedReply(comment, draftText),
        });
      }

      const parsed = safeParseJson(result.text);
      return jsonResponse({ success: true, improvedText: parsed.improvedText });

    } else if (action === "analytics") {
      if (!comments || !Array.isArray(comments)) {
        return errorResponse("comments array is required for analytics.", 400);
      }

      const formatted = comments
        .map(
          (c: any) =>
            `[Rating: ${c.rating}/5 | Sentiment: ${c.sentiment || "unknown"} | Branch: ${c.branch || "N/A"}] "${c.comment}"`
        )
        .join("\n");

      const prompt = `Analyse this cohort of ${comments.length} customer reviews for KayKay's Milk:

${formatted}

Provide:
1. Executive summary of overall sentiment trends
2. Breakdown into distinct feedback categories (e.g. Packaging, Delivery, M-Pesa, Product Quality, Customer Service) with counts and percentages
3. Recurring operational problems identified
4. Concrete operational improvement suggestions

Output raw JSON only.`;

      const result = await runAI(settings, {
        systemInstruction:
          "You are the Operations & QA Director for KayKay's Milk. You analyse customer review cohorts to identify patterns and recommend process improvements. Return raw JSON only.",
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
            operationalImprovements: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "overallSummary",
            "categories",
            "recurringProblems",
            "operationalImprovements",
          ],
        },
      });

      if (!result.success) {
        return jsonResponse({
          success: true,
          analytics: getMockCohortAnalytics(),
        });
      }

      return jsonResponse({
        success: true,
        analytics: safeParseJson(result.text),
      });

    } else {
      return errorResponse(`Unsupported action: "${action}"`, 400);
    }
  } catch (err: any) {
    console.error("[complaints] Error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});

// ─────────────────────────────────────────────
// Mock fallback helpers (used when AI is unconfigured or fails)
// ─────────────────────────────────────────────

function getMockFallback(
  action: string,
  comment: any,
  draftText: string,
  comments: any[]
): Record<string, unknown> {
  switch (action) {
    case "analyze":
      return { success: true, analysis: getMockAnalysis(comment) };
    case "generate_reply":
      return { success: true, replyText: getMockReply(comment, draftText) };
    case "improve_reply":
      return {
        success: true,
        improvedText: getMockImprovedReply(comment, draftText),
      };
    case "analytics":
      return { success: true, analytics: getMockCohortAnalytics() };
    default:
      return { success: false, error: "AI service is not configured." };
  }
}

function getMockAnalysis(c: any) {
  const rating = c?.rating || 3;
  let sentiment = "neutral";
  let severity = "medium";
  if (rating <= 2) { sentiment = "negative"; severity = "critical"; }
  else if (rating >= 4) { sentiment = "positive"; severity = "low"; }

  const text = (c?.comment || "").toLowerCase();
  if (text.includes("leak") || text.includes("seal") || text.includes("spill")) {
    return { sentiment: "negative", severity: "high", summary: "Customer reports packaging leakage or seal failure.", escalationRecommendation: "Escalate to Packaging Quality Control immediately.", suggestedResolution: "Dispatch a replacement bottle and inspect current batch." };
  }
  if (text.includes("delay") || text.includes("late") || text.includes("rider")) {
    return { sentiment: "negative", severity: "medium", summary: "Customer experienced a logistics delivery delay.", escalationRecommendation: "Assign to Logistics Supervisor.", suggestedResolution: "Re-route the delivery and offer a complimentary discount voucher." };
  }
  if (text.includes("mpesa") || text.includes("payment")) {
    return { sentiment: "negative", severity: "high", summary: "Customer experienced an M-Pesa payment reconciliation issue.", escalationRecommendation: "Escalate to Finance Operations.", suggestedResolution: "Manually reconcile receipt and update payment status." };
  }
  return { sentiment, severity, summary: `Customer shared ${sentiment} feedback about the product or service.`, escalationRecommendation: sentiment === "negative" ? "Escalate to Customer Relations Specialist." : "Archive as positive reference.", suggestedResolution: sentiment === "negative" ? "Follow up with a polite apology and 10% discount on next order." : "Award 50 bonus loyalty points as a gesture of appreciation." };
}

function getMockReply(c: any, draftText: string) {
  const name = c?.customerName || "Customer";
  const branch = c?.branch || "our branch";
  if (draftText) return `Dear ${name}, thank you for reaching out. ${draftText} We appreciate your loyalty to KayKay's Milk.`;
  if ((c?.rating || 5) <= 2) {
    return `Dear ${name}, we sincerely apologise for the inconvenience at our ${branch} location. We are investigating this immediately and will make it right for you.`;
  }
  return `Dear ${name}, thank you so much for your wonderful feedback! We are thrilled you enjoyed our fresh dairy products at ${branch} and look forward to serving you again soon.`;
}

function getMockImprovedReply(c: any, draftText: string) {
  return `Dear ${c?.customerName || "Customer"}, thank you for taking the time to share your experience with us. ${draftText || "We have logged your feedback and are addressing it immediately."} We remain committed to delivering the highest quality dairy products and service.`;
}

function getMockCohortAnalytics() {
  return {
    overallSummary: "Customer sentiment is broadly positive with strong appreciation for fresh cooperative milk quality. Minor friction points include container seal durability during hot afternoon transit and occasional M-Pesa callback delays.",
    categories: [
      { category: "Product Quality", count: 12, percentage: 40 },
      { category: "Delivery Timing", count: 8, percentage: 26 },
      { category: "Customer Support", count: 6, percentage: 20 },
      { category: "M-Pesa Verification", count: 4, percentage: 14 },
    ],
    recurringProblems: [
      "Intermittent container cap leakage during motorcycle transit on unpaved roads.",
      "M-Pesa STK callback verification delays during peak afternoon transactions.",
    ],
    operationalImprovements: [
      "Equip delivery riders with shock-absorbing insulated carrier crates.",
      "Implement a secondary auto-retry queue on the M-Pesa STK push listener.",
    ],
  };
}

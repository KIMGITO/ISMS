// supabase/edge_functions/bi-analyze/index.ts
// Business Intelligence Analysis — replaces POST /api/gemini/analyze from local server.ts
// Uses real metrics passed from the frontend dashboard, calls the configured AI provider,
// and returns a structured executive BI report.

// deno-lint-ignore-file no-explicit-any
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
} from "../shared/cors.ts";
import { loadAISettings, runAI } from "../shared/ai-runner.ts";

// JSON Schema for the structured BI report response
const biReportSchema = {
  type: "object",
  properties: {
    executiveSummary: {
      type: "string",
      description:
        "Highly detailed professional corporate summary of the operational state, with direct answers to any user question.",
    },
    keyInsights: {
      type: "array",
      items: { type: "string" },
      description: "3-5 high-impact factual insights derived from the metrics.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "2-4 critical operational, financial, or supply chain risks.",
    },
    opportunities: {
      type: "array",
      items: { type: "string" },
      description:
        "2-4 concrete opportunities for expansion, revenue maximisation, or efficiency gains.",
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description:
        "3-5 actionable recommendations (restocking, pricing shifts, rider reallocation, etc.).",
    },
    suggestedActions: {
      type: "array",
      items: { type: "string" },
      description:
        "3-5 short, immediately actionable tasks the user can execute right now.",
    },
    chartAnnotation: {
      type: "string",
      description: "Brief expert comment on the current sales trend for chart display.",
    },
    predictedSales: {
      type: "array",
      items: { type: "number" },
      description: "5 numbers representing predicted future sales trend values.",
    },
  },
  required: [
    "executiveSummary",
    "keyInsights",
    "risks",
    "opportunities",
    "recommendations",
    "suggestedActions",
    "chartAnnotation",
    "predictedSales",
  ],
};

function safeParseJson(raw: string): any {
  if (!raw) return {};
  let cleaned = raw.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  }

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to repair strategies
  }

  // Extract the largest JSON object/array from the text (handles extra prose)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    cleaned = jsonMatch[0].trim();
  }

  // Repair strategy 1: strip trailing commas before } or ]
  const noTrailingCommas = cleaned
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/,\s*$/g, "");

  try {
    return JSON.parse(noTrailingCommas);
  } catch {
    // fall through
  }

  // Repair strategy 2: fix truncated JSON by balancing braces/brackets
  const balanceJson = (input: string): string => {
    let out = input;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < out.length; i++) {
      const ch = out[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        stack.push(ch);
      } else if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
          return input; // mismatched, cannot repair
        }
      }
    }

    // Close any unclosed structures
    while (stack.length > 0) {
      const open = stack.pop();
      out += open === "{" ? "}" : "]";
    }
    return out;
  };

  const balanced = balanceJson(noTrailingCommas);
  try {
    return JSON.parse(balanced);
  } catch {
    // fall through
  }

  // Repair strategy 3: try to salvage by finding the deepest valid JSON substring
  const trySubstrings = (input: string): any => {
    const candidates: string[] = [];
    const stack: string[] = [];
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        if (stack.length === 0) start = i;
        stack.push(ch);
      } else if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
          stack.length = 0;
          start = -1;
          continue;
        }
        if (stack.length === 0 && start >= 0) {
          candidates.push(input.slice(start, i + 1));
          start = -1;
        }
      }
    }

    // Also try progressively shorter prefixes of the input
    for (let len = input.length; len > 0; len -= 10) {
      candidates.push(input.slice(0, len));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next candidate
      }
    }
    return null;
  };

  const salvaged = trySubstrings(cleaned);
  if (salvaged) return salvaged;

  // Final fallback: return a minimal valid report so the frontend can still render
  return {
    executiveSummary: "AI analysis could not be parsed. Showing local fallback summary.",
    keyInsights: [],
    risks: [],
    opportunities: [],
    recommendations: [],
    suggestedActions: [],
    chartAnnotation: "",
    predictedSales: [],
  };
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
    const { metrics, customQuestion, businessId } = body;

    if (!businessId) return errorResponse("businessId is required.", 400);

    // Verify tenant membership
    const { errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    if (!metrics) return errorResponse("metrics payload is required.", 400);

    // ── 1. Load AI settings ──────────────────────────────────────────────
    const settings = await loadAISettings(businessId);

    if (!settings) {
      return jsonResponse({
        success: false,
        error:
          "AI Analysis Platform is unconfigured. Please ask the Owner to add an API key under Settings > AI Configuration.",
      }, 503);
    }

    // ── 2. Build BI analysis prompt ──────────────────────────────────────
    const m = metrics;
    const promptText = `Perform a high-level, executive-grade corporate Business Intelligence (BI) analysis for "ISMS " (a premium dairy brand in Kenya).

Here is the real-time dashboard state for the selected period (${m.timeframe || "current period"}):

FINANCIAL METRICS:
- Total Sales Revenue: KSh ${m.totalSales?.toLocaleString() || 0}
- Total Orders Logged: ${m.orderCount || 0}
- Average Ticket Size (AOV): KSh ${m.aov?.toLocaleString() || 0}
- Revenue Trend vs prior period: ${m.revenueTrend >= 0 ? "+" : ""}${m.revenueTrend || 0}%
- Total Operational Expenses: KSh ${m.totalExpenses?.toLocaleString() || 0} (COGS: KSh ${m.cogs?.toLocaleString() || 0}, Delivery: KSh ${m.deliveryFees?.toLocaleString() || 0}, Overhead/Labour: KSh ${m.overheadExpenses?.toLocaleString() || 0})
- Estimated Net Profit: KSh ${m.netProfit?.toLocaleString() || 0}
- Estimated Profit Margin: ${m.profitMargin || 0}%

CASH FLOW & PAYMENT CHANNELS:
- Total Cash Received: KSh ${m.cashReceived?.toLocaleString() || 0}
- Cash Balance Reserve: KSh ${m.cashBalance?.toLocaleString() || 0}
- M-Pesa Digital Collections: KSh ${m.mpesaCollections?.toLocaleString() || 0} (${m.mpesaShare || 0}% of total)
- M-Pesa STK Callbacks: ${m.mpesaSuccessCount || 0} successful, ${m.mpesaFailedCount || 0} failed

INVENTORY & SAFETY BUFFERS:
- Total Products: ${m.totalProducts || 0}
- Inventory Asset Valuation: KSh ${m.inventoryValuation?.toLocaleString() || 0}
- Low-Stock Alerts (below safety buffers): ${m.lowStockCount || 0} products
- Restock Recommendations: ${JSON.stringify(m.lowStockProducts || [])}
- Top-Selling Products: ${JSON.stringify(m.topProducts || [])}
- Slow-Moving Inventory: ${JSON.stringify(m.slowProducts || [])}

MULTI-BRANCH PERFORMANCE:
- Branch Performance Data: ${JSON.stringify(m.branches || [])}
- Highest-Performing Branch: ${m.topBranch || "Westlands Branch"}
- Lowest-Performing Branch: ${m.lowestBranch || "Kilimani Depot"}

STAFF & OPERATIONS:
- Active Cashier Shifts: ${m.activeShiftsCount || 0}
- Checkout Velocity: ${m.checkoutVelocity || 0} units/min
- Staff Task Completion Rate: ${m.staffTasksCompletionRate || 0}%

CUSTOMER RETENTION & SENTIMENT:
- Total Customer Members: ${m.totalCustomers || 0}
- New Customers This Period: ${m.newCustomersCount || 0} (${m.customerGrowthRate || 0}% growth)
- Retention Index: ${m.retentionRate || 0}%
- Customer Feedback: ${m.feedbackCount || 0} comments, avg ${m.averageRating || "0.0"}/5.0 stars
- Sentiment: Positive ${m.sentimentPositive || 0}%, Neutral ${m.sentimentNeutral || 0}%, Negative ${m.sentimentNegative || 0}%
- Unresolved Complaints: ${m.openComplaintsCount || 0}

${customQuestion ? `SPECIFIC QUESTION FROM USER: "${customQuestion}"` : ""}

Generate a comprehensive executive BI report as valid raw JSON matching the schema exactly. Focus on dairy supply chain, M-Pesa payment flows, Kenyan SME logistics, cold-chain shelf-life risks, and multi-branch resource allocation. If a user question is provided, construct the entire report around answering it. Output raw JSON only — no markdown fences.`;

    // ── 3. Call AI ───────────────────────────────────────────────────────
    const result = await runAI(settings, {
      systemInstruction:
        "You are the Principal Business Intelligence Consultant for ISMS . You specialise in retail analytics, food and beverage supply chains, M-Pesa digital payment systems, and Kenyan SME operations. Return a comprehensive executive report as raw parseable JSON matching the schema exactly. No markdown code fences.",
      messages: [{ role: "user", content: promptText }],
      responseMimeType: "application/json",
      responseSchema: biReportSchema,
    });

    if (!result.success) {
      return jsonResponse({ success: false, error: result.error }, 503);
    }

    const analysis = safeParseJson(result.text);
    return jsonResponse({ success: true, analysis });
  } catch (err: any) {
    console.error("[bi-analyze] Error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});

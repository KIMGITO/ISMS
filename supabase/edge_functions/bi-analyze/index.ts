// supabase/edge_functions/bi-analyze/index.ts
// Business Intelligence Analysis — replaces POST /api/gemini/analyze from local server.ts
// Uses real metrics passed from the frontend dashboard, calls the configured AI provider,
// and returns a structured executive BI report.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  handleCors,
  jsonResponse,
  errorResponse,
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

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { metrics, customQuestion, businessId } = await req.json();

    if (!businessId) return errorResponse("businessId is required.", 400);
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
    const promptText = `Perform a high-level, executive-grade corporate Business Intelligence (BI) analysis for "KayKay's Milk" (a premium dairy brand in Kenya).

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
        "You are the Principal Business Intelligence Consultant for KayKay's Milk. You specialise in retail analytics, food and beverage supply chains, M-Pesa digital payment systems, and Kenyan SME operations. Return a comprehensive executive report as raw parseable JSON matching the schema exactly. No markdown code fences.",
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

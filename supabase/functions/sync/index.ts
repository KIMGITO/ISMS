// supabase/edge_functions/sync/index.ts
// Transaction Sync — replaces GET + POST /api/sync from local server.ts
// Pushes offline transactions from the app into Supabase's offline_sync_queue table
// (or retrieves previously synced records) so they survive app restarts and device switches.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
} from "../shared/cors.ts";

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // ── GET: Retrieve synced transactions for a business ─────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const businessId = url.searchParams.get("businessId");

      if (!businessId) {
        return errorResponse("businessId query param is required.", 400);
      }

      const { data, error } = await supabase
        .from("offline_sync_queue")
        .select("*")
        .eq("business_id", businessId)
        .eq("sync_status", "synced")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("[sync] GET error:", error);
        return errorResponse("Failed to retrieve synced transactions.", 500);
      }

      // Return the payload field of each record (the original transaction JSON)
      const transactions = (data || []).map((row: any) => ({
        ...(row.payload || {}),
        syncedAt: row.synced_at || row.created_at,
      }));

      return jsonResponse({ success: true, transactions });

    // ── POST: Push offline transactions to Supabase ──────────────────────
    } else if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }
      const { transactions, businessId } = body;

      if (!businessId) return errorResponse("businessId is required.", 400);
      if (!Array.isArray(transactions)) {
        return errorResponse("transactions must be an array.", 400);
      }

      if (transactions.length === 0) {
        return jsonResponse({ success: true, count: 0, total: 0 });
      }

      const now = new Date().toISOString();

      // Upsert each transaction into offline_sync_queue by entity_id (the transaction's own ID)
      const rows = transactions.map((t: any) => ({
        business_id: businessId,
        entity_type: "transaction",
        entity_id: t.id,
        payload: t,
        sync_status: "synced",
        synced_at: now,
        created_at: now,
        updated_at: now,
      }));

      const { data: upserted, error: upsertErr } = await supabase
        .from("offline_sync_queue")
        .upsert(rows, { onConflict: "business_id,entity_type,entity_id" })
        .select("entity_id");

      if (upsertErr) {
        console.error("[sync] upsert error:", upsertErr);
        // Fallback: try insert-on-conflict-ignore for older schema
        const { error: insertErr } = await supabase
          .from("offline_sync_queue")
          .insert(rows);

        if (insertErr) {
          console.error("[sync] insert fallback error:", insertErr);
          return errorResponse("Failed to sync transactions.", 500);
        }
      }

      // Count total synced for this business
      const { count: total } = await supabase
        .from("offline_sync_queue")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("sync_status", "synced");

      return jsonResponse({
        success: true,
        count: transactions.length,
        total: total || transactions.length,
      });

    } else {
      return errorResponse("Method not allowed.", 405);
    }
  } catch (err: any) {
    console.error("[sync] Critical error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});

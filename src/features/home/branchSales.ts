// src/features/home/branchSales.ts
// The app only loads the open branch's sales, so branch comparisons fetch a light
// list (amount and time only) for the other branches. Row access is enforced by RLS.

import { getSupabase } from "../../services/supabaseClient";
import { toUuid } from "../../utils/idUtils";
import type { BranchSale, DateRange } from "./metrics";

const PAGE = 1000;
const MAX_PAGES = 50;

export async function fetchBranchSales(branchIds: string[], range: DateRange): Promise<BranchSale[]> {
  const ids = branchIds.filter((id) => id && id !== "biz-1").map((id) => toUuid(id));
  if (ids.length === 0) return [];
  const out: BranchSale[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await getSupabase()
      .from("transactions")
      .select("id, business_id, final_total, total, timestamp")
      .in("business_id", ids)
      .gte("timestamp", range.start.toISOString())
      .lte("timestamp", range.end.toISOString())
      .order("timestamp", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    for (const row of data || []) {
      const final = Number(row.final_total);
      out.push({
        businessId: row.business_id,
        amount: Number.isFinite(final) ? final : Number(row.total) || 0,
        ts: new Date(row.timestamp).getTime(),
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

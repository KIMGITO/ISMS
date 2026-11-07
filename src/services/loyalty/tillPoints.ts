// Points a customer spent at the till, per sale, so the receipt (and any reprint) can show
// them. Kept on the device right away and linked to the sale in the database.
import { getSupabase } from "../supabaseClient";

export interface TillPoints {
  points: number;
  value: number;
}

const KEY = "kkm_till_points_v1";
const MAX = 300;

function load(): Record<string, TillPoints> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(map: Record<string, TillPoints>) {
  try {
    const ids = Object.keys(map);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX))) delete map[id];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage blocked: the database link still covers reprints */
  }
}

/** Points earned on a sale, the same rule as the database (1 point per 100 spent, delivery excluded). */
export function pointsEarned(finalTotal: number, deliveryFee = 0): number {
  return Math.max(0, Math.floor(((Number(finalTotal) || 0) - (Number(deliveryFee) || 0)) / 100));
}

/** Remembers the points on this device and links them to the sale in the database. */
export async function recordTillPoints(transactionId: string, redemptionId: string, used: TillPoints): Promise<void> {
  const map = load();
  map[transactionId] = used;
  save(map);
  const { error } = await getSupabase().rpc("link_till_points", { p_redemption_id: redemptionId, p_transaction_id: transactionId });
  if (error) console.warn("Could not link points to the sale:", error.code || error.message);
}

/** Points spent on a sale, or null when none were used. */
export async function getTillPoints(transactionId: string): Promise<TillPoints | null> {
  const local = load()[transactionId];
  if (local) return local;
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) return null;
  try {
    const { data, error } = await getSupabase()
      .from("loyalty_redemptions")
      .select("points, value")
      .eq("transaction_id", transactionId)
      .is("refunded_at", null);
    if (error || !data?.length) return null;
    return {
      points: data.reduce((s: number, r: any) => s + (Number(r.points) || 0), 0),
      value: data.reduce((s: number, r: any) => s + (Number(r.value) || 0), 0),
    };
  } catch {
    return null;
  }
}

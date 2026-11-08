// What one loyalty point is worth, by tier. Points are a reward inside the app, not money:
// at the till they come off the price, on the customer's page they pay off debt. They are
// never recorded as cash or M-Pesa. Same values as the database (fn_point_value).
import { getSupabase } from "../supabaseClient";

export type Tier = "Bronze" | "Silver" | "Gold";

export interface PointSettings {
  /** KSh value of one point in each tier. */
  bronze: number;
  silver: number;
  gold: number;
  minRedeem: number;
}

/** Per KSh 1: Bronze 50 points, Silver 100, Gold 200. */
export const DEFAULT_POINT_SETTINGS: PointSettings = { bronze: 0.02, silver: 0.01, gold: 0.005, minRedeem: 100 };

export function pointValueFor(settings: PointSettings, tier: string | undefined): number {
  return tier === "Gold" ? settings.gold : tier === "Silver" ? settings.silver : settings.bronze;
}

/** "50 points = KSh 1" */
export function pointsPerShilling(value: number): number {
  return value > 0 ? Math.round(1 / value) : 0;
}

export async function fetchPointSettings(businessId: string): Promise<PointSettings> {
  const { data, error } = await getSupabase()
    .from("loyalty_settings")
    .select("value_bronze, value_silver, value_gold, min_redeem_points")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error || !data) return DEFAULT_POINT_SETTINGS;
  const num = (v: unknown, d: number) => (Number(v) > 0 ? Number(v) : d);
  return {
    bronze: num(data.value_bronze, DEFAULT_POINT_SETTINGS.bronze),
    silver: num(data.value_silver, DEFAULT_POINT_SETTINGS.silver),
    gold: num(data.value_gold, DEFAULT_POINT_SETTINGS.gold),
    minRedeem: num(data.min_redeem_points, DEFAULT_POINT_SETTINGS.minRedeem),
  };
}

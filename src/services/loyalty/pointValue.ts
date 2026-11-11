// What one loyalty point is worth, by tier. Points are a reward inside the app, not money:
// at the till they come off the price, on the customer's page they pay off debt. They are
// never recorded as cash or M-Pesa. Same values as the database (fn_point_value).
import { useEffect, useState } from "react";
import { getSupabase } from "../supabaseClient";

export type Tier = "Bronze" | "Silver" | "Gold";

export interface PointSettings {
  /** KSh value of one point in each tier. */
  bronze: number;
  silver: number;
  gold: number;
  minRedeem: number;
  /** Off: nothing earns or spends points and the app hides them (20261111004). */
  enabled: boolean;
}

/** Per KSh 1: Bronze 50 points, Silver 100, Gold 200. */
export const DEFAULT_POINT_SETTINGS: PointSettings = { bronze: 0.02, silver: 0.01, gold: 0.005, minRedeem: 100, enabled: true };

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
    .select("*") // "*" so a database without points_enabled yet still loads
    .eq("business_id", businessId)
    .maybeSingle();
  if (error || !data) return DEFAULT_POINT_SETTINGS;
  enabledCache.set(businessId, data.points_enabled !== false);
  const num = (v: unknown, d: number) => (Number(v) > 0 ? Number(v) : d);
  return {
    bronze: num(data.value_bronze, DEFAULT_POINT_SETTINGS.bronze),
    silver: num(data.value_silver, DEFAULT_POINT_SETTINGS.silver),
    gold: num(data.value_gold, DEFAULT_POINT_SETTINGS.gold),
    minRedeem: num(data.min_redeem_points, DEFAULT_POINT_SETTINGS.minRedeem),
    enabled: data.points_enabled !== false,
  };
}

// "Are points on?" for screens that only need to hide points. Read once per business and
// shared; the settings switch updates it straight away through setPointsEnabled.
const enabledCache = new Map<string, boolean>();
const enabledListeners = new Set<() => void>();

export function setPointsEnabled(businessId: string, enabled: boolean) {
  enabledCache.set(businessId, enabled);
  enabledListeners.forEach((fn) => fn());
}

/** Cached answer, or true while unknown (the database refuses points when off anyway). */
export function pointsEnabledNow(businessId: string | null | undefined): boolean {
  return businessId ? enabledCache.get(businessId) ?? true : true;
}

export async function loadPointsEnabled(businessId: string): Promise<boolean> {
  if (!enabledCache.has(businessId)) {
    const s = await fetchPointSettings(businessId);
    setPointsEnabled(businessId, s.enabled);
  }
  return enabledCache.get(businessId)!;
}

export function usePointsEnabled(businessId: string | null | undefined): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    enabledListeners.add(listener);
    if (businessId) loadPointsEnabled(businessId).catch(() => undefined);
    return () => void enabledListeners.delete(listener);
  }, [businessId]);
  return pointsEnabledNow(businessId);
}

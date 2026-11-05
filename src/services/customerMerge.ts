// src/services/customerMerge.ts
// Finds and merges customer records that belong to the same person.

import { Customer, CustomerTier } from "../types";
import { getSupabase } from "./supabaseClient";

export const NO_EMAIL_PLACEHOLDER = "no-email@kaykays.com";

export interface DuplicateGroup {
  matchOn: "phone" | "email";
  matchValue: string;
  customerIds: string[];
  accountCustomerIds: string[];
}

/** The same rule as fn_phone_key in the database. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (/^0\d{9}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return digits;
}

const TIER_ORDER: CustomerTier[] = ["Bronze", "Silver", "Gold"];

/** What merge_customers will produce, for showing staff before they confirm. */
export function previewMerge(keep: Customer, merge: Customer) {
  const debt = (keep.debtBalance ?? 0) + (merge.debtBalance ?? 0);
  const wallet = (keep.walletBalance ?? 0) + (merge.walletBalance ?? 0);
  const offset = Math.min(debt, wallet);
  const points = keep.loyaltyPoints + merge.loyaltyPoints;
  // Tiers rise with points in the database, so adding two balances can move someone up.
  const earned: CustomerTier = points >= 300 ? "Gold" : points >= 100 ? "Silver" : "Bronze";
  return {
    debt: debt - offset,
    wallet: wallet - offset,
    offset,
    points,
    purchases: keep.purchasesCount + merge.purchasesCount,
    tier: TIER_ORDER[Math.max(TIER_ORDER.indexOf(keep.tier), TIER_ORDER.indexOf(merge.tier), TIER_ORDER.indexOf(earned))],
  };
}

/** The shop's own record is kept by default: no online login first, then the most purchases. */
export function defaultKeepId(a: Customer, b: Customer, accountCustomerIds: string[]): string {
  const aOnline = accountCustomerIds.includes(a.id);
  const bOnline = accountCustomerIds.includes(b.id);
  if (aOnline !== bOnline) return aOnline ? b.id : a.id;
  return b.purchasesCount > a.purchasesCount ? b.id : a.id;
}

export async function findDuplicateCustomers(businessId: string): Promise<DuplicateGroup[]> {
  const { data, error } = await getSupabase().rpc("find_duplicate_customers", { p_business_id: businessId });
  if (error) throw error;
  return (data ?? []) as DuplicateGroup[];
}

export async function dismissDuplicateCustomers(businessId: string, customerIds: string[]): Promise<void> {
  const { error } = await getSupabase().rpc("dismiss_duplicate_customers", {
    p_business_id: businessId,
    p_customer_ids: customerIds,
  });
  if (error) throw error;
}

export async function mergeCustomers(keepId: string, mergeId: string, name: string, phone: string, email: string): Promise<void> {
  const { error } = await getSupabase().rpc("merge_customers", {
    p_keep_id: keepId,
    p_merge_id: mergeId,
    p_name: name,
    p_phone: phone,
    p_email: email,
  });
  if (error) throw error;
}

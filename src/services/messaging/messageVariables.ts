// Variables in messages to customers. One message is written once, with {first_name},
// {debt} and the like; each customer gets their own values. Built-in variables come from
// the customer and the shop; the business can add its own, one value for everybody
// (table message_variables). The AI drafting prompt gets the same list (describe).
import type { Customer } from "../../types";
import { CUSTOMER_TYPE_LABELS } from "../../types";
import { getFirstName, customerName } from "../../utils/stringUtils";
import { getSupabase } from "../supabaseClient";
import { pointValueFor, type PointSettings } from "../loyalty/pointValue";

export interface CustomVariable {
  id?: string;
  key: string;
  label: string;
  value: string;
}

export interface PurchaseStats {
  lastPurchaseAt: string | null;
  purchases: number;
  totalSpent: number;
}

/** Everything a message needs besides the customer. */
export interface MessageContext {
  businessName: string;
  businessPhone?: string;
  currency?: string;
  /** Missing or off: point variables read as 0. */
  points?: PointSettings | null;
  stats?: Map<string, PurchaseStats>;
  custom?: CustomVariable[];
}

export type VariableGroup = "Customer" | "Money" | "Points" | "Buying" | "Shop";

export interface VariableDef {
  key: string;
  label: string;
  group: VariableGroup;
  /** For the AI prompt and the help text. */
  describe: string;
  value: (c: Customer, ctx: MessageContext) => string;
  /** True when this value says nothing useful for the customer (no debt, no purchase...). */
  empty?: (c: Customer, ctx: MessageContext) => boolean;
}

/** "KSh 1,250" or "KSh 1,250.50": whole shillings drop the cents. */
export function money(amount: number | null | undefined, currency = "KSh"): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const whole = Number.isInteger(n);
  return `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
};

const pointsOn = (ctx: MessageContext) => !!ctx.points && ctx.points.enabled !== false;
const stat = (c: Customer, ctx: MessageContext) => ctx.stats?.get(c.id);

export const BUILT_IN_VARIABLES: VariableDef[] = [
  { key: "first_name", label: "First name", group: "Customer", describe: "customer's first name", value: (c) => getFirstName(customerName(c.name)) || "Customer" },
  { key: "full_name", label: "Full name", group: "Customer", describe: "customer's full name", value: (c) => customerName(c.name) || "Customer" },
  { key: "phone", label: "Phone", group: "Customer", describe: "customer's phone number", value: (c) => c.phone || "" , empty: (c) => !c.phone },
  { key: "account_no", label: "Account no.", group: "Customer", describe: "customer's account number, quoted when paying by M-Pesa", value: (c) => c.accountNumber || "", empty: (c) => !c.accountNumber },
  { key: "customer_type", label: "Customer type", group: "Customer", describe: "Individual, Business, Institution or Other", value: (c) => CUSTOMER_TYPE_LABELS[c.customerType ?? "individual"] },
  { key: "debt", label: "Amount owed", group: "Money", describe: "how much the customer owes, with currency", value: (c, ctx) => money(c.debtBalance, ctx.currency), empty: (c) => !((c.debtBalance || 0) > 0) },
  { key: "wallet", label: "Wallet balance", group: "Money", describe: "money in the customer's wallet with the shop, with currency", value: (c, ctx) => money(c.walletBalance, ctx.currency), empty: (c) => !((c.walletBalance || 0) > 0) },
  { key: "points", label: "Points", group: "Points", describe: "the customer's loyalty points", value: (c, ctx) => (pointsOn(ctx) ? (c.loyaltyPoints || 0) : 0).toLocaleString("en-KE"), empty: (c, ctx) => !pointsOn(ctx) || !(c.loyaltyPoints > 0) },
  {
    key: "points_value",
    label: "Points worth",
    group: "Points",
    describe: "what the customer's points take off a purchase, with currency (not cash)",
    value: (c, ctx) => money(pointsOn(ctx) ? Math.floor((c.loyaltyPoints || 0) * pointValueFor(ctx.points!, c.tier)) : 0, ctx.currency),
    empty: (c, ctx) => !pointsOn(ctx) || !(c.loyaltyPoints > 0),
  },
  { key: "tier", label: "Tier", group: "Points", describe: "Bronze, Silver or Gold", value: (c) => c.tier || "Bronze" },
  {
    key: "last_purchase",
    label: "Last bought",
    group: "Buying",
    describe: "date of the customer's last purchase",
    value: (c, ctx) => (stat(c, ctx)?.lastPurchaseAt ? shortDate(stat(c, ctx)!.lastPurchaseAt!) : "a while ago"),
    empty: (c, ctx) => !stat(c, ctx)?.lastPurchaseAt,
  },
  {
    key: "days_since_purchase",
    label: "Days since last bought",
    group: "Buying",
    describe: "number of days since the customer last bought",
    value: (c, ctx) => {
      const at = stat(c, ctx)?.lastPurchaseAt;
      return at ? String(Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000))) : "";
    },
    empty: (c, ctx) => !stat(c, ctx)?.lastPurchaseAt,
  },
  { key: "purchases", label: "Number of purchases", group: "Buying", describe: "how many times the customer has bought", value: (c, ctx) => String(stat(c, ctx)?.purchases ?? c.purchasesCount ?? 0) },
  { key: "total_spent", label: "Total spent", group: "Buying", describe: "everything the customer has bought, with currency", value: (c, ctx) => money(stat(c, ctx)?.totalSpent ?? 0, ctx.currency), empty: (c, ctx) => !(stat(c, ctx)?.totalSpent) },
  { key: "store_name", label: "Shop name", group: "Shop", describe: "the shop's name", value: (_c, ctx) => ctx.businessName || "our shop" },
  { key: "store_phone", label: "Shop phone", group: "Shop", describe: "the shop's phone number", value: (_c, ctx) => ctx.businessPhone || "", empty: (_c, ctx) => !ctx.businessPhone },
  { key: "today", label: "Today's date", group: "Shop", describe: "today's date", value: () => shortDate(new Date().toISOString()) },
];

/** Older messages used {business_name}; it still works. */
const ALIASES: Record<string, string> = { business_name: "store_name", name: "first_name" };

export const BUILT_IN_KEYS = new Set([...BUILT_IN_VARIABLES.map((v) => v.key), ...Object.keys(ALIASES)]);

/** Built-in variables, then the business's own. */
export function allVariables(ctx: MessageContext): VariableDef[] {
  const custom = (ctx.custom ?? []).map<VariableDef>((v) => ({
    key: v.key,
    label: v.label,
    group: "Shop",
    describe: `${v.label} (same for everyone): ${v.value}`,
    value: () => v.value,
  }));
  return [...BUILT_IN_VARIABLES, ...custom];
}

const TOKEN = /\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}/g;

function lookup(ctx: MessageContext): Map<string, VariableDef> {
  const map = new Map(allVariables(ctx).map((v) => [v.key, v]));
  for (const [alias, key] of Object.entries(ALIASES)) if (map.has(key)) map.set(alias, map.get(key)!);
  return map;
}

/** The message as this customer gets it. Unknown {names} are left as written. */
export function fillMessage(template: string, customer: Customer, ctx: MessageContext): string {
  const vars = lookup(ctx);
  return template.replace(TOKEN, (whole, raw: string) => {
    const def = vars.get(raw.toLowerCase());
    return def ? def.value(customer, ctx) : whole;
  });
}

/** Variables written in the message that nothing fills in (typos, deleted ones). */
export function unknownVariables(template: string, ctx: MessageContext): string[] {
  const vars = lookup(ctx);
  const out = new Set<string>();
  for (const m of template.matchAll(TOKEN)) if (!vars.has(m[1].toLowerCase())) out.add(m[1]);
  return [...out];
}

/** Variables used in the message that have nothing to say for some recipients, with how many. */
export function emptyFor(template: string, customers: Customer[], ctx: MessageContext): { label: string; count: number }[] {
  const vars = lookup(ctx);
  const used = new Set<VariableDef>();
  for (const m of template.matchAll(TOKEN)) {
    const def = vars.get(m[1].toLowerCase());
    if (def?.empty) used.add(def);
  }
  return [...used]
    .map((def) => ({ label: def.label, count: customers.filter((c) => def.empty!(c, ctx)).length }))
    .filter((x) => x.count > 0);
}

export function validCustomKey(key: string): string | null {
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(key)) return "Use 2 to 30 small letters, numbers or _, starting with a letter.";
  if (BUILT_IN_KEYS.has(key)) return `{${key}} is already a built-in variable.`;
  return null;
}

/** "Offer ends" → "offer_ends" */
export function keyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 30);
}

export async function listCustomVariables(businessId: string): Promise<CustomVariable[]> {
  const { data, error } = await getSupabase()
    .from("message_variables")
    .select("id, key, label, value")
    .eq("business_id", businessId)
    .order("label");
  if (error) {
    // Before the migration the table is missing: built-in variables still work.
    console.warn("Could not load message variables:", error.message);
    return [];
  }
  return (data ?? []) as CustomVariable[];
}

export async function saveCustomVariable(businessId: string, v: CustomVariable, by?: string): Promise<CustomVariable> {
  const { data, error } = await getSupabase()
    .from("message_variables")
    .upsert(
      { business_id: businessId, key: v.key, label: v.label.trim(), value: v.value, updated_by: by ?? null, updated_at: new Date().toISOString() },
      { onConflict: "business_id,key" },
    )
    .select("id, key, label, value")
    .single();
  if (error) throw error;
  return data as CustomVariable;
}

export async function deleteCustomVariable(id: string): Promise<void> {
  const { error } = await getSupabase().from("message_variables").delete().eq("id", id);
  if (error) throw error;
}

/** Last purchase, count and total per customer. Empty when the database can't answer yet. */
export async function fetchPurchaseStats(businessId: string): Promise<Map<string, PurchaseStats>> {
  const map = new Map<string, PurchaseStats>();
  const { data, error } = await getSupabase().rpc("customer_purchase_stats", { p_business_id: businessId });
  if (error) {
    console.warn("Could not load purchase history:", error.message);
    return map;
  }
  for (const r of (data ?? []) as any[]) {
    map.set(r.customer_id, {
      lastPurchaseAt: r.last_purchase_at ?? null,
      purchases: Number(r.purchases) || 0,
      totalSpent: Number(r.total_spent) || 0,
    });
  }
  return map;
}

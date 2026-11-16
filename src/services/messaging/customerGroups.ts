// Customer groups for picking who gets a message (and for filtering the customer list).
// Chosen groups combine like shop filters: within one section a customer needs any of
// them (Gold or Silver), across sections all of them (Gold and owes money).
import type { Customer } from "../../types";
import { CUSTOMER_TYPE_LABELS, PAYMENT_TERMS_LABELS, DELIVERY_FREQUENCY_LABELS } from "../../types";
import type { PointSettings } from "../loyalty/pointValue";
import type { PurchaseStats } from "./messageVariables";

export interface GroupContext {
  points?: PointSettings | null;
  stats?: Map<string, PurchaseStats>;
}

export interface CustomerGroup {
  id: string;
  label: string;
  section: string;
  test: (c: Customer, ctx: GroupContext) => boolean;
  /** Hidden when it can't apply (points off). */
  hidden?: (ctx: GroupContext) => boolean;
}

const DAY = 86_400_000;
const daysSince = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / DAY : Infinity);
const lastBought = (c: Customer, ctx: GroupContext) => ctx.stats?.get(c.id)?.lastPurchaseAt ?? null;
const hasBought = (c: Customer, ctx: GroupContext) => !!lastBought(c, ctx) || (c.purchasesCount || 0) > 0;
const pointsOff = (ctx: GroupContext) => !ctx.points || ctx.points.enabled === false;

export const CUSTOMER_GROUPS: CustomerGroup[] = [
  { id: "owes", label: "Owes money", section: "Money", test: (c) => (c.debtBalance || 0) > 0 },
  { id: "owes_min:1000", label: "Owes KSh 1,000 or more", section: "Money", test: (c) => (c.debtBalance || 0) >= 1000 },
  { id: "owes_min:5000", label: "Owes KSh 5,000 or more", section: "Money", test: (c) => (c.debtBalance || 0) >= 5000 },
  { id: "owes_nothing", label: "Owes nothing", section: "Money", test: (c) => !((c.debtBalance || 0) > 0) },
  { id: "wallet", label: "Has wallet money", section: "Money", test: (c) => (c.walletBalance || 0) > 0 },

  { id: "points_ready", label: "Has enough points to use", section: "Points", hidden: pointsOff, test: (c, ctx) => (c.loyaltyPoints || 0) >= (ctx.points?.minRedeem ?? 100) },
  { id: "tier:Bronze", label: "Bronze", section: "Tier", test: (c) => (c.tier || "Bronze") === "Bronze" },
  { id: "tier:Silver", label: "Silver", section: "Tier", test: (c) => c.tier === "Silver" },
  { id: "tier:Gold", label: "Gold", section: "Tier", test: (c) => c.tier === "Gold" },

  { id: "bought_within:7", label: "Bought in the last 7 days", section: "Buying", test: (c, ctx) => daysSince(lastBought(c, ctx)) <= 7 },
  { id: "quiet:30", label: "Not bought for 30+ days", section: "Buying", test: (c, ctx) => hasBought(c, ctx) && daysSince(lastBought(c, ctx)) > 30 },
  { id: "quiet:60", label: "Not bought for 60+ days", section: "Buying", test: (c, ctx) => hasBought(c, ctx) && daysSince(lastBought(c, ctx)) > 60 },
  { id: "never_bought", label: "Never bought", section: "Buying", test: (c, ctx) => !hasBought(c, ctx) },
  { id: "joined_within:30", label: "Joined in the last 30 days", section: "Buying", test: (c) => daysSince(c.joinDate) <= 30 },

  ...Object.entries(CUSTOMER_TYPE_LABELS).map(([v, label]) => ({
    id: `customerType:${v}`, label, section: "Customer type",
    test: (c: Customer) => (c.customerType ?? "individual") === v,
  })),
  ...Object.entries(PAYMENT_TERMS_LABELS).map(([v, label]) => ({
    id: `paymentTerms:${v}`, label, section: "Payment terms",
    test: (c: Customer) => (c.paymentTerms ?? "pay_now") === v,
  })),
  ...Object.entries(DELIVERY_FREQUENCY_LABELS).map(([v, label]) => ({
    id: `deliveryFrequency:${v}`, label, section: "Delivery",
    test: (c: Customer) => (c.deliveryFrequency ?? "none") === v,
  })),

  { id: "offers_ok", label: "Agreed to offers", section: "Messages", test: (c) => !!c.notifyPromotions },
  { id: "has_email", label: "Has an email", section: "Messages", test: (c) => !!c.email && c.email !== "no-email@kaykays.com" },
];

const BY_ID = new Map(CUSTOMER_GROUPS.map((g) => [g.id, g]));

export const groupById = (id: string) => BY_ID.get(id);

export function visibleGroups(ctx: GroupContext): CustomerGroup[] {
  return CUSTOMER_GROUPS.filter((g) => !g.hidden?.(ctx));
}

/** One predicate for the chosen groups (none chosen: everyone). Unknown ids are ignored. */
export function groupMatcher(ids: string[], ctx: GroupContext): (c: Customer) => boolean {
  const bySection = new Map<string, CustomerGroup[]>();
  for (const id of ids) {
    const g = BY_ID.get(id);
    if (!g || g.hidden?.(ctx)) continue;
    bySection.set(g.section, [...(bySection.get(g.section) ?? []), g]);
  }
  const sections = [...bySection.values()];
  return (c) => sections.every((gs) => gs.some((g) => g.test(c, ctx)));
}

/** "Owes money · Gold or Silver" */
export function describeGroups(ids: string[]): string {
  const bySection = new Map<string, string[]>();
  for (const id of ids) {
    const g = BY_ID.get(id);
    if (g) bySection.set(g.section, [...(bySection.get(g.section) ?? []), g.label]);
  }
  return [...bySection.values()].map((labels) => labels.join(" or ")).join(" · ");
}

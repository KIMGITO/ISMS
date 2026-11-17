// src/services/promotions.ts
// Promotion codes and the referral programme (migrations 20261126001-003).
// The database works out every discount and reward; the app only shows what it is told.
// At the till: promoCheck (preview) -> promoReserve (holds one use, gives the real discount)
// -> the sale is saved with the hold's id -> or promoRelease if the sale fails.
import { getSupabase } from './supabaseClient';
import type { CartItem } from '../types';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw error;
  return data as T;
}

// ─────────────────────────────────────────────── till
export interface PromoLine {
  productId: string;
  name: string;
  category?: string | null;
  quantity: number;
  net: number;
  discount: number;
}

/** What the server says about a code on this cart. */
export interface PromoResult {
  ok: boolean;
  /** Why it can't be used (when ok is false). */
  reason?: string;
  /** What to do about it, e.g. "Add KSh 150 more." */
  hint?: string;
  /** Extra information when ok, e.g. "Capped at the KSh 300 most this promotion gives." */
  note?: string;
  code?: string;
  name?: string;
  summary?: string;
  kind?: string;
  discount?: number;
  subtotal?: number;
  lines?: PromoLine[];
  /** Referral codes: the referrer by first name, and what each side gets. */
  referral?: boolean;
  referrer?: string;
  welcome?: string;
  referrerReward?: string;
  /** Set by promoReserve. */
  redemptionId?: string;
  expiresAt?: string;
}

/** The cart as the server reads it: what is charged per line. */
export function promoItems(cart: CartItem[]) {
  return cart.map((i) => ({
    product_id: i.product.id,
    product_name: i.product.name,
    quantity: i.quantity,
    unit_price: i.product.price,
    discount_percentage: i.discountPercentage,
  }));
}

const asNumbers = (r: PromoResult): PromoResult => ({
  ...r,
  discount: r.discount != null ? Number(r.discount) : undefined,
  subtotal: r.subtotal != null ? Number(r.subtotal) : undefined,
});

export async function promoCheck(businessId: string, code: string, customerId: string | null, cart: CartItem[], otherDiscount: number) {
  return asNumbers(await rpc<PromoResult>('promo_check', {
    p_business_id: businessId, p_code: code, p_customer_id: customerId,
    p_items: promoItems(cart), p_other_discount: Math.round(otherDiscount * 100) / 100,
  }));
}

/** Holds one use for 20 minutes and returns the discount to charge. Throws the reason when refused. */
export async function promoReserve(businessId: string, code: string, customerId: string | null, cart: CartItem[], otherDiscount: number, referenceId?: string) {
  return asNumbers(await rpc<PromoResult>('promo_reserve', {
    p_business_id: businessId, p_code: code, p_customer_id: customerId,
    p_items: promoItems(cart), p_other_discount: Math.round(otherDiscount * 100) / 100, p_reference_id: referenceId ?? null,
  }));
}

/** Gives the held use back (the sale didn't happen). Never throws: the hold also times out. */
export async function promoRelease(redemptionId: string | null | undefined) {
  if (!redemptionId) return;
  const { error } = await getSupabase().rpc('promo_release', { p_redemption_id: redemptionId });
  if (error) console.error('Could not give back the promotion hold:', error.code);
}

// ─────────────────────────────────────────────── managing promotions
export type PromoType = 'percentage' | 'fixed' | 'buy_x_get_y' | 'free_product' | 'min_spend' | 'customer' | 'first_purchase';
export type PromoKind = 'percent' | 'amount' | 'free_items';
export type PromoStatus = 'active' | 'off' | 'scheduled' | 'expired' | 'used_up' | 'archived';
export type ProductScope = 'all' | 'products' | 'categories';
export type Audience = 'everyone' | 'selected' | 'first_purchase';

export interface Promotion {
  id: string;
  code: string;
  name: string;
  description: string | null;
  promoType: PromoType;
  kind: PromoKind;
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  oncePerCustomer: boolean;
  stackable: boolean;
  audience: Audience;
  productScope: ProductScope;
  buyQty: number | null;
  rewardProductId: string | null;
  rewardQty: number | null;
  usePos: boolean;
  useOnline: boolean;
  showOnWebsite: boolean;
  active: boolean;
  archivedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  ownBranch: boolean;
  status: PromoStatus;
  summary: string;
  productIds: string[];
  categories: string[];
  customerIds: string[];
  branchIds: string[];
  uses: number;
  held: number;
  discountGiven: number;
}

/** What the editor sends; save_promotion checks every field again. */
export type PromotionDraft = Pick<Promotion,
  'name' | 'code' | 'description' | 'promoType' | 'kind' | 'value' | 'maxDiscount' | 'minOrder' | 'startsAt' | 'endsAt' |
  'maxUses' | 'oncePerCustomer' | 'stackable' | 'audience' | 'productScope' | 'productIds' | 'categories' | 'customerIds' |
  'branchIds' | 'buyQty' | 'rewardProductId' | 'rewardQty' | 'usePos' | 'useOnline' | 'showOnWebsite' | 'active'>;

const num = (v: unknown) => (v == null ? null : Number(v));

export async function listPromotions(businessId: string): Promise<Promotion[]> {
  const rows = await rpc<any[]>('promotions_list', { p_business_id: businessId });
  return (rows || []).map((p) => ({
    ...p,
    value: Number(p.value), minOrder: Number(p.minOrder), maxDiscount: num(p.maxDiscount), maxUses: num(p.maxUses),
    buyQty: num(p.buyQty), rewardQty: num(p.rewardQty), uses: Number(p.uses), held: Number(p.held),
    discountGiven: Number(p.discountGiven),
  }));
}

export const savePromotion = (businessId: string, id: string | null, draft: PromotionDraft) =>
  rpc<string>('save_promotion', { p_business_id: businessId, p_id: id, p_doc: draft });

export const setPromotionStatus = (id: string, action: 'activate' | 'deactivate' | 'archive' | 'restore') =>
  rpc<void>('set_promotion_status', { p_id: id, p_action: action });

export const generatePromoCode = (businessId: string, prefix = '') =>
  rpc<string>('promo_generate_code', { p_business_id: businessId, p_prefix: prefix });

export interface PromotionUse {
  id: string;
  at: string;
  status: 'reserved' | 'redeemed' | 'expired' | 'cancelled' | 'refunded' | 'partially_refunded';
  channel: 'pos' | 'online';
  discount: number;
  saleTotal: number | null;
  refunded: number;
  customer: string | null;
  staff: string | null;
  branch: string | null;
  endReason: string | null;
  receipt: string | null;
  order: string | null;
}

export const listPromotionUses = (promotionId: string) =>
  rpc<PromotionUse[]>('promotion_redemptions_list', { p_promotion_id: promotionId, p_limit: 200 });

export interface PromotionDashboard {
  counts: { total: number; active: number; scheduled: number; expired: number; off: number; archived: number };
  totals: { redemptions: number; discount: number; grossSales: number; otherDiscounts: number; netSales: number; avgNet: number; customers: number };
  refunds: { count: number; partial: number; amount: number };
  withoutPromotion: { sales: number; avgNet: number };
  byPromotion: { promotionId: string; code: string; name: string; uses: number; discount: number; grossSales: number; netSales: number; netPerShilling: number | null; discountShare: number | null }[];
  byProduct: { productId: string; name: string; category: string | null; quantity: number; net: number; discount: number; uses: number }[];
  byDay: { date: string; uses: number; discount: number; netSales: number }[];
}

export const promotionDashboard = (businessId: string, from: string, to: string) =>
  rpc<PromotionDashboard>('promotion_dashboard', { p_business_id: businessId, p_from: from, p_to: to });

// ─────────────────────────────────────────────── referrals
export type RewardKind = 'amount' | 'percent' | 'wallet' | 'free_product' | 'points';
export type ReferralStatus = 'pending' | 'qualified' | 'rewarded' | 'rejected' | 'cancelled' | 'expired';

export interface ReferralCampaignDraft {
  name: string;
  description: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  referrerKind: RewardKind;
  referrerValue: number | null;
  referrerProductId: string | null;
  referrerQty: number | null;
  welcomeKind: RewardKind;
  welcomeValue: number | null;
  welcomeProductId: string | null;
  welcomeQty: number | null;
  minPurchase: number;
  maxDiscount: number | null;
  productScope: ProductScope;
  productIds: string[];
  categories: string[];
  branchIds: string[];
  stackable: boolean;
  maxPerReferrer: number | null;
  maxTotal: number | null;
  maxRewardsPerCustomer: number | null;
  rewardExpiryDays: number | null;
  holdDays: number;
  excludeExisting: boolean;
  newCustomerDays: number;
  requirePhone: boolean;
  reviewFlagged: boolean;
}

export interface ReferralRow {
  id: string;
  at: string;
  status: ReferralStatus;
  code: string;
  referrer: string;
  referred: string;
  purchase: number | null;
  welcomeDiscount: number;
  flags: string[];
  staff: string | null;
  rewardDueAt: string | null;
  endReason: string | null;
  receipt: string | null;
  rewards: { side: 'referrer' | 'referred'; kind: string; status: string; what: string }[];
}

export interface ReferralDashboard {
  campaign: (Record<string, any> & {
    id: string; name: string; referrerText: string; welcomeText: string;
    welcome: { minPurchase: number; maxDiscount: number | null; stackable: boolean; productScope: ProductScope; productIds: string[]; categories: string[]; branchIds: string[] };
  }) | null;
  counts: { total: number; pending: number; qualified: number; rewarded: number; rejected: number; cancelled: number; expired: number; flagged: number; firstPurchases: number };
  costs: { wallet: number; welcomeDiscounts: number; rewardCodesUsed: number; rewardCodesOpen: number; points: number; takenBack: number; total: number };
  referredSales: number;
  topReferrers: { customerId: string; name: string; code: string; codeId: string; codeStatus: string; referrals: number; rewarded: number; flagged: number; cost: number }[];
  referrals: ReferralRow[];
}

export const referralDashboard = (businessId: string, from: string, to: string) =>
  rpc<ReferralDashboard>('referral_dashboard', { p_business_id: businessId, p_from: from, p_to: to });

export const saveReferralCampaign = (businessId: string, id: string | null, draft: ReferralCampaignDraft) =>
  rpc<string>('save_referral_campaign', { p_business_id: businessId, p_id: id, p_doc: draft });

export const endReferralCampaign = (id: string) => rpc<void>('end_referral_campaign', { p_id: id });

export const decideReferral = (id: string, approve: boolean, reason?: string) =>
  rpc<void>('decide_referral', { p_referral_id: id, p_approve: approve, p_reason: reason ?? null });

export const setReferralCodeStatus = (codeId: string, status: 'active' | 'suspended' | 'revoked', reason?: string) =>
  rpc<void>('set_referral_code_status', { p_code_id: codeId, p_status: status, p_reason: reason ?? null });

export interface CustomerReferral {
  code: string | null;
  codeId: string | null;
  codeStatus: 'active' | 'suspended' | 'revoked' | null;
  codeReason: string | null;
  campaign: { name: string; endsAt: string | null; youGet: string; friendGets: string; minPurchase: number } | null;
  invited: number;
  successful: number;
  pending: number;
  rewardsEarned: number;
  rewardsAvailable: { kind: string; what: string; code: string | null; expiresAt: string | null }[];
  rewardsUsed: number;
  walletEarned: number;
  pointsEarned: number;
  friends: { name: string; status: ReferralStatus; at: string }[];
}

export const customerReferral = (customerId: string) =>
  rpc<CustomerReferral>('customer_referral', { p_customer_id: customerId });

/** The words a customer sends with their code. */
export function referralShareText(businessName: string, r: CustomerReferral): string {
  const c = r.campaign;
  const min = c && Number(c.minPurchase) > 0 ? ` on your first purchase of KSh ${Number(c.minPurchase).toLocaleString('en-KE')} or more` : ' on your first purchase';
  return `Shop at ${businessName} and give my code ${r.code} at the counter: you get ${c?.friendGets ?? 'a welcome reward'}${min}.`;
}

// ─────────────────────────────────────────────── words
export const PROMO_TYPES: { id: PromoType; label: string; hint: string }[] = [
  { id: 'percentage', label: 'Percentage off', hint: 'e.g. MILK10: 10% off' },
  { id: 'fixed', label: 'Amount off', hint: 'e.g. SAVE100: KSh 100 off' },
  { id: 'min_spend', label: 'Spend and save', hint: 'Spend KSh 1,000, get KSh 100 off' },
  { id: 'buy_x_get_y', label: 'Buy X, get Y free', hint: 'Buy 2 litres, get 500 ml free' },
  { id: 'free_product', label: 'Free product', hint: 'A free item when the conditions are met' },
  { id: 'customer', label: 'For chosen customers', hint: 'Only the customers you pick can use it' },
  { id: 'first_purchase', label: 'First purchase', hint: 'For a customer who has never bought' },
];

export const PROMO_STATUS_LABEL: Record<PromoStatus, string> = {
  active: 'Active', off: 'Off', scheduled: 'Scheduled', expired: 'Ended', used_up: 'Used up', archived: 'Archived',
};

export const REWARD_KINDS: { id: RewardKind; label: string }[] = [
  { id: 'amount', label: 'Amount off' },
  { id: 'percent', label: 'Percentage off' },
  { id: 'wallet', label: 'Wallet credit' },
  { id: 'free_product', label: 'Free product' },
  { id: 'points', label: 'Loyalty points' },
];

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: 'Pending', qualified: 'Qualified', rewarded: 'Rewarded', rejected: 'Rejected', cancelled: 'Cancelled', expired: 'Expired',
};

export const REFERRAL_FLAG_LABEL: Record<string, string> = {
  many_in_a_day: 'Many referrals in a day',
  same_cashier_again: 'Same cashier again',
  just_over_minimum: 'Just over the minimum',
  added_at_the_till: 'Customer added at the till',
  similar_phone: 'Phone close to the referrer’s',
  refunded_after_reward: 'Refunded after reward',
};

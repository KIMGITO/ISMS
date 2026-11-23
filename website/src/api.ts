import type { HeroSlide } from './heroSlides';
import type { AdCard } from './adCards';
import { createClient } from '@supabase/supabase-js';

/** The website's own shop. Other branches with the same owner can be picked in the store picker. */
export const WEBSITE_SLUG = import.meta.env.VITE_WEBSITE_SLUG || 'kaykays';

const STORE_KEY = 'kaykays-store';

/** The shop being browsed: the branch the customer picked on this device, or the website's own. */
export function storeSlug(): string {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && /^[a-z0-9-]{1,60}$/.test(saved)) return saved;
  } catch { /* storage blocked: the website's own shop */ }
  return WEBSITE_SLUG;
}

export function rememberStore(slug: string) {
  try {
    if (slug === WEBSITE_SLUG) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, slug);
  } catch { /* it just won't be remembered */ }
}

const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'kaykays-customer-auth' },
});

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  description: string | null;
  image: string | null;
  inStock: boolean;
  /** The "was" price, only when higher than the price (20261114006). */
  wasPrice?: number | null;
}

/** A branch customers can switch to (20261114006). */
export interface Store {
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  openingHours: string | null;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  coverImageUrl: string | null;
  publishedAt: string | null;
}

export interface Storefront {
  business: {
    name: string;
    /** The website name of this shop (20261114006). */
    slug?: string;
    description: string | null;
    address: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    logoUrl: string | null;
    coverImageUrl: string | null;
    primaryColor: string | null;
    currency: string;
    paymentMethods: string[];
  };
  settings: {
    deliveryEnabled: boolean;
    deliveryFee: number;
    minOrder: number;
    assistantEnabled: boolean;
    /** Added in 20261110006, so older databases leave these out. */
    openingHours?: string | null;
    whatsapp?: string | null;
  };
  /** Staff-written text for info pages, keyed by page id (about, terms…). Empty means use the default. */
  pages?: Partial<Record<string, string>>;
  /** Home banner slides from Online Store > Home banner (20261111002). Empty or missing: built-in slides. */
  heroSlides?: HeroSlide[];
  loyalty?: {
    /** False when the shop has switched points off (20261111004). Missing means on. */
    enabled?: boolean;
    pointsPerShilling: number;
    valueBronze: number;
    valueSilver: number;
    valueGold: number;
    minRedeem: number;
  };
  /** Approved reviews, newest first (20261110008). */
  reviews?: Review[];
  /** Promo codes staff chose to advertise on the website (20261110008). */
  promotions?: Promotion[];
  /** Advert cards from Online Store > Adverts (20261114006). Empty or missing: built-in cards. */
  adCards?: AdCard[];
  /** Branches with the website switched on, this one included (20261114006). */
  stores?: Store[];
  deliveryZones: DeliveryZone[];
  branches: { name: string; address: string | null }[];
  products: Product[];
  articles: Article[];
}

export interface Review {
  id: string;
  /** Null for a review of the shop as a whole. */
  productId: string | null;
  rating: number;
  title: string | null;
  body: string;
  name: string;
  verified: boolean;
  featured: boolean;
  reply: string | null;
  createdAt: string;
}

export interface Promotion {
  code: string;
  description: string | null;
  kind: 'percent' | 'amount';
  value: number;
  minOrder: number;
  endsAt: string | null;
}

export interface PromoCheck {
  code: string;
  description: string | null;
  kind: 'percent' | 'amount';
  value: number;
  saving: number;
}

export interface Account {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  delivery_address: string | null;
  delivery_building?: string | null;
  delivery_landmark?: string | null;
  delivery_notes: string | null;
  delivery_zone_id?: string | null;
}

/** The parts of a delivery location, as the profile and checkout forms edit them. */
export interface LocationDraft {
  zoneId: string;
  address: string;
  building: string;
  landmark: string;
  notes: string;
}

export const locationOf = (account: Account | null): LocationDraft => ({
  zoneId: account?.delivery_zone_id ?? '',
  address: account?.delivery_address ?? '',
  building: account?.delivery_building ?? '',
  landmark: account?.delivery_landmark ?? '',
  notes: account?.delivery_notes ?? '',
});

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export type OrderStatus =
  | 'pending_payment' | 'payment_failed' | 'paid' | 'preparing'
  | 'out_for_delivery' | 'ready_for_pickup' | 'completed' | 'cancelled';

export interface Order {
  id: string;
  order_number: number;
  status: OrderStatus;
  fulfilment: 'delivery' | 'pickup';
  delivery_address: string | null;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  points_value?: number;
  promo_code?: string | null;
  promo_value?: number;
  mpesa_receipt: string | null;
  /** Added in 20261110009; older databases leave these out. */
  payment_method?: 'M-Pesa' | 'Card' | 'Airtel Money' | null;
  payment_reference?: string | null;
  created_at: string;
  online_order_items: OrderItem[];
}

export interface CartLine {
  productId: string;
  quantity: number;
}

/** A regular order: one product with an amount for each day, Sunday first (20261130005). */
export interface RegularOrder {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  price: number;
  dayQty: number[];
  status: 'requested' | 'active' | 'paused' | 'declined' | 'ended';
  fulfilment: 'delivery' | 'pickup';
  address: string | null;
  note: string | null;
  /** A change you asked for that the shop hasn't confirmed yet. */
  pendingDayQty: number[] | null;
  pendingFulfilment: 'delivery' | 'pickup' | null;
  pendingAddress: string | null;
  pendingNote: string | null;
  decisionNote: string | null;
}

export interface RegularDay {
  orderId: string;
  day: string;
  state: 'due' | 'changed' | 'skipped' | 'delivered';
  quantity: number;
  message: string | null;
}

export interface Message {
  id: string;
  sender: 'customer' | 'staff' | 'system';
  staff_name: string | null;
  body: string;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface FeedbackInput {
  name: string;
  contact: string;
  rating: number | null;
  comment: string;
  type: 'feedback' | 'suggestion' | 'complaint';
  productId: string | null;
}

export interface AssistantReply {
  reply: string;
  pendingProductId?: string | null;
  addToCart?: { productId: string; quantity: number; name: string; total: number } | null;
  link?: { label: string; href: string } | null;
  /** A product the assistant talked about, which the chat offers to open. */
  productId?: string | null;
}

/**
 * Server functions RAISE plain sentences meant for customers (code P0001).
 * Anything else, like a network or permissions error, stays generic.
 */
/**
 * Turns any error into one plain sentence a customer can act on. Database checks (P0001) already
 * speak to the customer; everything else is matched by code or message, and the fallback still
 * says what to try next instead of a bare "something went wrong".
 */
export function friendlyError(err: unknown, fallback = 'That didn\'t work. Please try again, or contact us if it keeps happening.'): string {
  const e = err as { code?: string; message?: string; status?: number; customerMessage?: string; name?: string };
  if (e?.customerMessage) return e.customerMessage;
  if (e?.code === 'P0001' && e.message) return e.message;
  const message = (e?.message ?? '').toLowerCase();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You seem to be offline. Please check your internet connection and try again.';
  }
  if (e?.name === 'TypeError' && message.includes('fetch')) {
    return 'We couldn\'t reach our server. Please check your internet connection and try again.';
  }
  if (e?.code === '57014' || e?.status === 504 || message.includes('timed out') || message.includes('timeout')) {
    return 'Our server took too long to answer. Please wait a moment and try again.';
  }
  if (e?.code === '42501' || e?.status === 401 || message.includes('jwt')) {
    return 'Your sign-in has expired. Please sign out, sign in again and retry.';
  }
  if (e?.code === 'PGRST202' || e?.code === '42883') {
    return 'This part of the website is being updated. Please try again later.';
  }
  if (e?.status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return 'Too many tries in a short time. Please wait a few minutes and try again.';
  }
  return fallback;
}

/** Clear messages for sign-in and sign-up problems, keyed by Supabase Auth error codes. */
export function authErrorMessage(err: unknown, action: 'signin' | 'signup' | 'reset' | 'password' | 'phone' | 'code'): string {
  const e = err as { code?: string; message?: string; status?: number };
  const code = e?.code ?? '';
  const message = (e?.message ?? '').toLowerCase();
  const has = (...words: string[]) => words.some((w) => code.includes(w) || message.includes(w));
  if (has('user_already_exists', 'email_exists', 'already registered', 'already been registered')) {
    return 'An account with this email already exists. Please sign in instead, or use "Forgot your password?".';
  }
  if (has('email_not_confirmed', 'not confirmed')) {
    return 'Please confirm your email first. Open the link we emailed you (check the spam folder too), then sign in.';
  }
  if (has('invalid_credentials', 'invalid login')) {
    return 'That email or password is not right. Check for typing mistakes, or use "Forgot your password?".';
  }
  if (has('email_address_invalid', 'invalid format', 'unable to validate email', 'email address') && !has('rate')) {
    return 'That email address doesn\'t look right. Please check it, for example jane@gmail.com.';
  }
  if (has('weak_password', 'password should', 'password is')) {
    return 'That password is too weak. Use at least 8 characters with letters and numbers.';
  }
  if (has('same_password')) return 'Your new password must be different from your old one.';
  if (has('over_email_send_rate_limit', 'email rate limit')) {
    return 'We\'ve sent too many emails in the last hour. Please wait a little while and try again.';
  }
  if (has('over_sms_send_rate_limit', 'sms rate limit')) {
    return 'We\'ve sent too many codes to this number. Please wait a few minutes and try again.';
  }
  if (has('signup_disabled', 'signups not allowed')) {
    return 'New accounts are switched off at the moment. Please call or message us to order.';
  }
  if (has('otp_expired', 'token has expired', 'invalid otp')) {
    return action === 'code' ? 'That code is not right, or it has expired. Request a new one.' : 'That link has expired. Please ask for a new one.';
  }
  if (has('email_provider_disabled')) return 'Email sign-in is switched off at the moment. Please contact us.';
  if (has('phone_provider_disabled', 'sms_send_failed')) return 'We couldn\'t send a text message right now. Please use your email instead.';
  if (has('error sending', 'smtp')) {
    return 'We couldn\'t send the confirmation email. Please check the address, or try again in a few minutes.';
  }
  const general = friendlyError(err, '');
  if (general) return general;
  const fallback: Record<typeof action, string> = {
    signin: 'We couldn\'t sign you in. Please try again.',
    signup: 'We couldn\'t create your account. Please try again.',
    reset: 'We couldn\'t send the reset link. Please try again.',
    password: 'We couldn\'t save your new password. Please try again.',
    phone: 'We couldn\'t send the code. Please try again shortly.',
    code: 'That code didn\'t work. Please try again.',
  };
  return e?.message ? `${fallback[action]} (${e.message})` : fallback[action];
}

/** The signed-in person's id. "My" queries filter by it: staff logins can read every customer's rows. */
async function myUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

async function rpc<T = void>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error('Function failed'), { customerMessage: json.error });
  return json as T;
}

/** Whether a sign-in provider is switched on in Supabase. Assumes yes if the check itself fails. */
export async function isProviderEnabled(provider: 'google' | 'apple'): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
    const settings = await res.json();
    return settings.external?.[provider] !== false;
  } catch {
    return true;
  }
}

/** Whether Airtel Money is switched on for the shop (the payment screen also checks it is set up). */
export const takesAirtel = (site: Pick<Storefront, 'business'>) => (site.business.paymentMethods ?? []).includes('Airtel Money');

/** Returns null when the slug isn't published. */
export const fetchStorefront = (slug = storeSlug()) => rpc<Storefront | null>('get_public_storefront', { p_slug: slug });

/**
 * Moves the signed-in customer's account to this branch, so orders, points and messages go there.
 * Does nothing for a visitor, or on a database without branches on the website yet.
 */
export async function switchMyStore(slug: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  try {
    await rpc<string | null>('switch_my_store', { p_slug: slug });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'PGRST202' || code === '42883') return;
    throw err;
  }
}

export const submitFeedback = (input: FeedbackInput) =>
  rpc('submit_website_feedback', {
    p_slug: storeSlug(),
    p_name: input.name,
    p_contact: input.contact,
    p_rating: input.rating,
    p_comment: input.comment,
    p_type: input.type,
    p_product_id: input.productId,
  });

/** `history` is the chat so far, so the assistant can follow the conversation. */
export const askAssistant = (message: string, pendingProductId: string | null, history: { from: string; text: string }[] = []) =>
  callFunction<AssistantReply>('customer-assistant', { slug: storeSlug(), message, pendingProductId, history: history.slice(-8) });

export interface DeliveryZone {
  id: string;
  name: string;
  fee: number;
}

export interface Rewards {
  points: number;
  tier: string;
  wallet: number;
  debt: number;
  pointValue: number;
  minRedeem: number;
  /** False when the shop has switched points off. Missing means on. */
  enabled?: boolean;
}

export const fetchRewards = () => rpc<Rewards | null>('get_my_rewards', {});

/** The signed-in customer's referral code and how it's doing. Friends appear by first name only. */
export interface MyReferral {
  linked: boolean;
  running: boolean;
  code?: string | null;
  codeStatus?: 'active' | 'suspended' | 'revoked' | null;
  campaign?: { name: string; endsAt: string | null; youGet: string; friendGets: string; minPurchase: number } | null;
  invited?: number;
  successful?: number;
  pending?: number;
  rewardsEarned?: number;
  rewardsAvailable?: { kind: string; what: string; code: string | null; expiresAt: string | null }[];
  rewardsUsed?: number;
  walletEarned?: number;
  pointsEarned?: number;
  friends?: { name: string; status: string; at: string }[];
}
/** Null on a database without the referral programme (20261126002). */
export async function fetchMyReferral(): Promise<MyReferral | null> {
  try {
    return await rpc<MyReferral>('my_referral', { p_slug: storeSlug() });
  } catch {
    return null;
  }
}
/** Points pay off what the customer owes (never cash or wallet money). */
export const redeemPoints = (points: number) =>
  rpc<{ value: number; pointsUsed: number; points: number }>('redeem_my_points', { p_points: points });

export async function fetchAccount(): Promise<Account | null> {
  const uid = await myUserId();
  if (!uid) return null;
  const run = (columns: string) => supabase.from('customer_accounts').select(columns).eq('id', uid).maybeSingle();
  let result = await run('id, name, phone, email, delivery_address, delivery_building, delivery_landmark, delivery_notes, delivery_zone_id');
  // Before 20261128001 the building and landmark columns don't exist yet.
  if (result.error?.code === '42703') result = await run('id, name, phone, email, delivery_address, delivery_notes, delivery_zone_id');
  if (result.error) throw result.error;
  return result.data as unknown as Account | null;
}

export const createAccount = (name: string, phone: string) =>
  rpc<string>('create_customer_account', { p_slug: storeSlug(), p_name: name, p_phone: phone });

/** The customer agreed (or not) to offers; order updates stay on. Same switch as the app's. */
export async function saveOffersChoice(promotions: boolean) {
  const { error } = await supabase.rpc('update_my_contact_preferences', { p_service: true, p_promotions: promotions });
  if (error) throw error;
}

/** Saves the name, phone and whole delivery location, on the account and on the shop's customer record. */
export async function updateProfile(name: string, phone: string, loc: LocationDraft) {
  try {
    await rpc('update_my_profile', {
      p_name: name, p_phone: phone, p_address: loc.address, p_building: loc.building,
      p_landmark: loc.landmark, p_notes: loc.notes, p_zone_id: loc.zoneId || null,
    });
  } catch (err) {
    if ((err as { code?: string }).code !== 'PGRST202') throw err;
    // An older database: the address in one line.
    await rpc('update_my_account', {
      p_name: name, p_phone: phone,
      p_address: [loc.building, loc.address, loc.landmark].map((p) => p.trim()).filter(Boolean).join(', '),
      p_notes: loc.notes,
    });
  }
}

/** The promo code is only sent when there is one, so ordering still works on a database without promo codes. */
export async function placeOrder(items: CartLine[], fulfilment: string, address: string, notes: string, zoneId: string | null, points: number, promoCode: string | null = null) {
  // The order goes to the account's branch, so it must be the branch being shopped (another tab
  // or device may have switched it).
  await switchMyStore(storeSlug());
  return rpc<string>('place_online_order', {
    p_items: items, p_fulfilment: fulfilment, p_address: address, p_notes: notes, p_zone_id: zoneId, p_points: points,
    ...(promoCode ? { p_promo_code: promoCode } : {}),
  });
}

/** A wrong code comes back as { error } (not a database error), so wrong guesses can be counted. */
export async function checkPromoCode(code: string, subtotal: number): Promise<PromoCheck> {
  const result = await rpc<PromoCheck & { error?: string }>('check_promo_code', { p_slug: storeSlug(), p_code: code, p_subtotal: subtotal });
  if (result?.error) throw Object.assign(new Error(result.error), { customerMessage: result.error });
  return result;
}

// Reviews and regular orders name this branch's products, so the account moves to it first.
export async function submitReview(productId: string | null, rating: number, title: string, body: string) {
  await switchMyStore(storeSlug());
  return rpc<string>('submit_my_review', { p_product_id: productId, p_rating: rating, p_title: title, p_body: body });
}

export interface MyReview {
  id: string;
  product_id: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: 'pending' | 'approved' | 'hidden';
}

/** The signed-in customer's own reviews. Empty on a database without reviews. */
export async function fetchMyReviews(): Promise<MyReview[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('website_reviews')
    .select('id, product_id, rating, title, body, status')
    .eq('account_id', session.user.id);
  if (error) return [];
  return (data ?? []) as MyReview[];
}

export const cancelOrder = (orderId: string) => rpc('cancel_my_order', { p_order_id: orderId });

const BASE_ORDER_COLUMNS =
  'id, order_number, status, fulfilment, delivery_address, subtotal, delivery_fee, discount, total, mpesa_receipt, created_at, online_order_items(*)';
const PROMO_ORDER_COLUMNS = `${BASE_ORDER_COLUMNS}, points_value, promo_code, promo_value`;
const ORDER_COLUMNS = `${PROMO_ORDER_COLUMNS}, payment_method, payment_reference`;

/** Asks for the newest columns, and falls back while the database doesn't have them yet (error 42703). */
async function selectOrders<T>(run: (columns: string) => PromiseLike<{ data: T; error: { code?: string } | null }>): Promise<T> {
  let result = await run(ORDER_COLUMNS);
  if (result.error?.code === '42703') result = await run(PROMO_ORDER_COLUMNS);
  if (result.error?.code === '42703') result = await run(BASE_ORDER_COLUMNS);
  if (result.error) throw result.error;
  return result.data;
}

export async function fetchOrders(): Promise<Order[]> {
  const uid = await myUserId();
  if (!uid) return [];
  const data = await selectOrders((columns) =>
    supabase.from('online_orders').select(columns).eq('account_id', uid).order('created_at', { ascending: false }).limit(50));
  return (data ?? []) as unknown as Order[];
}

export async function fetchOrder(id: string): Promise<Order | null> {
  const uid = await myUserId();
  if (!uid) return null;
  const data = await selectOrders((columns) => supabase.from('online_orders').select(columns).eq('id', id).eq('account_id', uid).maybeSingle());
  return data as unknown as Order | null;
}

export type PhoneMethod = 'mpesa' | 'airtel';

/** Sends a payment prompt to the phone: M-Pesa (STK push) or Airtel Money. */
export const startPayment = (orderId: string, phone: string, method: PhoneMethod = 'mpesa') =>
  callFunction<{ success: boolean }>('customer-checkout', { action: 'pay', orderId, phone, method });

export const checkPayment = (orderId: string) =>
  callFunction<{ status: OrderStatus }>('customer-checkout', { action: 'check', orderId });

/** Starts a Paystack card checkout. Send the customer to authorizationUrl; Paystack sends them back to returnUrl. */
export const startCardPayment = (orderId: string, returnUrl: string) =>
  callFunction<{ authorizationUrl: string; reference: string }>('card-payments', { action: 'order_start', orderId, returnUrl });

export const checkCardPayment = (orderId: string, reference?: string) =>
  callFunction<{ status: OrderStatus }>('card-payments', { action: 'order_check', orderId, reference });

/** Whether the shop takes cards online. False on a database without card payments yet. */
export async function acceptsCards(): Promise<boolean> {
  try {
    return (await rpc<boolean>('website_accepts_cards', { p_slug: storeSlug() })) === true;
  } catch {
    return false;
  }
}

/** Whether the shop takes Airtel Money online. False on a database without Airtel yet. */
export async function acceptsAirtel(): Promise<boolean> {
  try {
    return (await rpc<boolean>('website_accepts_airtel', { p_slug: storeSlug() })) === true;
  } catch {
    return false;
  }
}

export async function fetchRegularOrders(): Promise<{ today: string; orders: RegularOrder[]; days: RegularDay[] }> {
  await switchMyStore(storeSlug());
  const data = await rpc<any>('get_my_regular_orders', {});
  const week = (v: unknown) => (Array.isArray(v) ? v.map((n) => Number(n) || 0) : [0, 0, 0, 0, 0, 0, 0]);
  return {
    today: data?.today ?? '',
    orders: (data?.orders ?? []).map((o: any) => ({ ...o, price: Number(o.price) || 0, dayQty: week(o.dayQty), pendingDayQty: o.pendingDayQty ? week(o.pendingDayQty) : null })),
    days: (data?.days ?? []).map((d: any) => ({ ...d, quantity: Number(d.quantity) || 0 })),
  };
}

/** Asks for a new regular order or a change to one. The shop confirms it; all zeros asks to stop. */
export const requestRegularOrder = (r: {
  id: string | null; productId: string | null; dayQty: number[]; fulfilment: 'delivery' | 'pickup'; address: string; note: string;
}) =>
  switchMyStore(storeSlug()).then(() => rpc<string>('request_regular_order', {
    p_id: r.id,
    p_product_id: r.productId,
    p_day_qty: r.dayQty,
    p_fulfilment: r.fulfilment,
    p_address: r.address,
    p_note: r.note,
  }));

/** Takes back a change not yet confirmed, or a request not yet approved. */
export const withdrawRegularOrderRequest = (id: string) => rpc('withdraw_my_regular_order_request', { p_id: id });

export async function fetchMessages(): Promise<Message[]> {
  const uid = await myUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('customer_messages')
    .select('id, sender, staff_name, body, order_id, read_at, created_at')
    .eq('account_id', uid)
    .order('created_at')
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Message[];
}

export const sendMessage = (body: string) => rpc('send_customer_message', { p_body: body });
export const markMessagesRead = () => rpc('mark_my_messages_read');

export interface ProductIdea {
  id: string;
  kind: 'upcoming' | 'suggestion';
  title: string;
  description: string | null;
  imageUrl: string | null;
  staffNote: string | null;
  status: 'pending' | 'open' | 'planned' | 'available';
  productId: string | null;
  suggestedBy: string | null;
  votes: number;
  voted: boolean;
  mine: boolean;
  createdAt: string;
}

/** Ideas for /ideas. Null when the database doesn't have product ideas yet. */
export async function fetchProductIdeas(): Promise<ProductIdea[] | null> {
  try {
    return (await rpc<ProductIdea[]>('get_product_ideas', { p_slug: storeSlug() })) ?? [];
  } catch (err) {
    if ((err as { code?: string }).code === 'PGRST202') return null;
    throw err;
  }
}

export const suggestProductIdea = (title: string, description: string) =>
  rpc<string>('suggest_product_idea', { p_title: title, p_description: description });

export const voteProductIdea = (ideaId: string, vote: boolean) =>
  rpc<{ votes: number; voted: boolean }>('vote_product_idea', { p_idea_id: ideaId, p_vote: vote });

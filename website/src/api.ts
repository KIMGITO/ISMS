import { createClient } from '@supabase/supabase-js';

export const WEBSITE_SLUG = import.meta.env.VITE_WEBSITE_SLUG || 'kaykays';

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
  };
  deliveryZones: DeliveryZone[];
  branches: { name: string; address: string | null }[];
  products: Product[];
  articles: Article[];
}

export interface Account {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  delivery_address: string | null;
  delivery_notes: string | null;
}

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
  mpesa_receipt: string | null;
  created_at: string;
  online_order_items: OrderItem[];
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface Schedule {
  id: string;
  items: CartLine[];
  days_of_week: number[];
  fulfilment: 'delivery' | 'pickup';
  delivery_address: string | null;
  notes: string | null;
  active: boolean;
  next_run_date: string;
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
}

/**
 * Server functions RAISE plain sentences meant for customers (code P0001).
 * Anything else, like a network or permissions error, stays generic.
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { code?: string; message?: string; customerMessage?: string };
  if (e?.customerMessage) return e.customerMessage;
  if (e?.code === 'P0001' && e.message) return e.message;
  return fallback;
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

/** Returns null when the slug isn't published. */
export const fetchStorefront = () => rpc<Storefront | null>('get_public_storefront', { p_slug: WEBSITE_SLUG });

export const submitFeedback = (input: FeedbackInput) =>
  rpc('submit_website_feedback', {
    p_slug: WEBSITE_SLUG,
    p_name: input.name,
    p_contact: input.contact,
    p_rating: input.rating,
    p_comment: input.comment,
    p_type: input.type,
    p_product_id: input.productId,
  });

export const askAssistant = (message: string, pendingProductId: string | null) =>
  callFunction<AssistantReply>('customer-assistant', { slug: WEBSITE_SLUG, message, pendingProductId });

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
}

export const fetchRewards = () => rpc<Rewards | null>('get_my_rewards', {});
export const redeemPoints = (points: number) => rpc('redeem_my_points', { p_points: points });

export async function fetchAccount(): Promise<Account | null> {
  const { data, error } = await supabase
    .from('customer_accounts')
    .select('id, name, phone, email, delivery_address, delivery_notes')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const createAccount = (name: string, phone: string) =>
  rpc<string>('create_customer_account', { p_slug: WEBSITE_SLUG, p_name: name, p_phone: phone });

export const updateAccount = (name: string, phone: string, address: string, notes: string) =>
  rpc('update_my_account', { p_name: name, p_phone: phone, p_address: address, p_notes: notes });

export const placeOrder = (items: CartLine[], fulfilment: string, address: string, notes: string, zoneId: string | null) =>
  rpc<string>('place_online_order', { p_items: items, p_fulfilment: fulfilment, p_address: address, p_notes: notes, p_zone_id: zoneId });

export const cancelOrder = (orderId: string) => rpc('cancel_my_order', { p_order_id: orderId });

const ORDER_COLUMNS =
  'id, order_number, status, fulfilment, delivery_address, subtotal, delivery_fee, discount, total, mpesa_receipt, created_at, online_order_items(*)';

export async function fetchOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('online_orders')
    .select(ORDER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function fetchOrder(id: string): Promise<Order | null> {
  const { data, error } = await supabase.from('online_orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Order | null;
}

export const startPayment = (orderId: string, phone: string) =>
  callFunction<{ success: boolean }>('customer-checkout', { action: 'pay', orderId, phone });

export const checkPayment = (orderId: string) =>
  callFunction<{ status: OrderStatus }>('customer-checkout', { action: 'check', orderId });

export async function fetchSchedules(): Promise<Schedule[]> {
  const { data, error } = await supabase
    .from('customer_order_schedules')
    .select('id, items, days_of_week, fulfilment, delivery_address, notes, active, next_run_date')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Schedule[];
}

export const saveSchedule = (schedule: Omit<Schedule, 'id' | 'next_run_date'> & { id: string | null }) =>
  rpc<string>('save_order_schedule', {
    p_id: schedule.id,
    p_items: schedule.items,
    p_days: schedule.days_of_week,
    p_fulfilment: schedule.fulfilment,
    p_address: schedule.delivery_address,
    p_notes: schedule.notes,
    p_active: schedule.active,
  });

export const deleteSchedule = (id: string) => rpc('delete_order_schedule', { p_id: id });

export async function fetchMessages(): Promise<Message[]> {
  const { data, error } = await supabase
    .from('customer_messages')
    .select('id, sender, staff_name, body, order_id, read_at, created_at')
    .order('created_at')
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Message[];
}

export const sendMessage = (body: string) => rpc('send_customer_message', { p_body: body });
export const markMessagesRead = () => rpc('mark_my_messages_read');

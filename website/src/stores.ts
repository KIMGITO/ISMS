// The store picker: each branch is its own shop with its own products, prices and stock.
// Changing store loads that branch's shop, moves a signed-in customer's account there (so orders,
// points and messages go to that branch), and keeps cart items the new branch also sells.
import { fetchStorefront, rememberStore, Storefront, switchMyStore, WEBSITE_SLUG } from './api';
import { useAuth, useCart, useSite } from './store';
import { applyBrand } from './engine/apply';

/** The branches a customer can pick from. The picker only shows with two or more. */
export const storesOf = (site: Pick<Storefront, 'stores'> | null | undefined) => site?.stores ?? [];
export const hasStorePicker = (site: Pick<Storefront, 'stores'> | null | undefined) => storesOf(site).length >= 2;

const normalise = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Switches to another branch. Returns how many cart lines could not come along (the new branch
 * doesn't sell them), so the page can say so. Throws a customer-ready error when it can't switch.
 */
export async function changeStore(slug: string): Promise<{ dropped: number }> {
  const current = useSite.getState().site;
  const next = await fetchStorefront(slug);
  if (!next) {
    throw Object.assign(new Error('Store unavailable'), { customerMessage: 'That branch isn\'t taking online orders right now. Please pick another.' });
  }
  // The account moves first: if that fails, the customer stays where they were.
  if (useAuth.getState().account) await switchMyStore(slug);
  rememberStore(slug);

  // Products are per branch, so cart lines are matched to the new branch's products by name.
  const { lines } = useCart.getState();
  const byName = new Map(next.products.filter((p) => p.inStock).map((p) => [normalise(p.name), p.id]));
  const oldProducts = new Map((current?.products ?? []).map((p) => [p.id, p]));
  const kept: typeof lines = [];
  for (const line of lines) {
    const old = oldProducts.get(line.productId);
    const id = old ? byName.get(normalise(old.name)) : next.products.some((p) => p.id === line.productId) ? line.productId : undefined;
    if (id) kept.push({ productId: id, quantity: line.quantity });
  }
  useCart.setState({ lines: kept });

  applyBrand(next);
  useSite.getState().setSite(next);
  return { dropped: lines.length - kept.length };
}

/**
 * Loads the shop this device last picked, falling back to the website's own when that branch is
 * gone or isn't one of this shop's branches.
 */
export async function loadStartingStore(load: (slug: string) => Promise<Storefront | null>, picked: string): Promise<Storefront | null> {
  if (picked !== WEBSITE_SLUG) {
    // A network error throws (the page retries); only a branch that is really gone is forgotten.
    const site = await load(picked);
    if (site && storesOf(site).some((s) => s.slug === WEBSITE_SLUG)) return site;
    rememberStore(WEBSITE_SLUG);
  }
  return load(WEBSITE_SLUG);
}

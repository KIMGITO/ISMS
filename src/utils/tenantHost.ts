// Which business an app address belongs to: <name>-app.interlockingblockbuilders.co.ke opens
// only that business (and its branches). Plain app.<domain>, localhost, workers.dev and the
// desktop/phone apps have no lock. Access itself is still decided by the database (RLS on
// business_memberships); this only stops one business's address showing another's data.
import { getSupabase } from '../services/supabaseClient';

export const PLATFORM_DOMAIN = 'interlockingblockbuilders.co.ke';

/** "acme-app.interlockingblockbuilders.co.ke" -> "acme"; anything else -> null. */
export function appHostSlug(hostname: string = typeof window !== 'undefined' ? window.location.hostname : ''): string | null {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  const suffix = `-app.${PLATFORM_DOMAIN}`;
  if (!h.endsWith(suffix)) return null;
  const slug = h.slice(0, -suffix.length);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) ? slug : null;
}

/**
 * Business ids this address may open, or null when the address has no lock. An empty list
 * means the signed-in person has no access to this address's business.
 */
export async function allowedBusinessIdsForHost(): Promise<string[] | null> {
  const slug = appHostSlug();
  if (!slug) return null;
  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from('businesses').select('id, tenant_id').eq('website_slug', slug).is('deleted_at', null).maybeSingle();
  if (!shop) return [];
  if (!shop.tenant_id) return [shop.id];
  const { data: same } = await supabase
    .from('businesses').select('id').eq('tenant_id', shop.tenant_id).is('deleted_at', null);
  return (same ?? []).map((b: { id: string }) => b.id);
}

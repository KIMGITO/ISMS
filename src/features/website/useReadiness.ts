// The readiness score for the website in the draft (website/src/engine/checks.ts). The draft
// supplies the design and words; the database supplies the facts the draft does not hold (web
// address, contact details, products shown and how many have a picture). Facts are reloaded
// when the draft changes, so a fix in another screen shows here without leaving Website.
import { useEffect, useMemo, useState } from 'react';
import { checkWebsite, type Readiness, type SiteFacts } from '../../../website/src/engine/checks';
import { getSupabase } from '../../services/supabaseClient';
import { toPublicBrand } from '../../services/websiteBrand';
import { useWebsiteDraft } from './useWebsiteDraft';

type ShopFacts = Pick<SiteFacts, 'name' | 'slug' | 'products'> & { phone: string | null; email: string | null; address: string | null };

async function loadShopFacts(businessId: string): Promise<ShopFacts> {
  const db = getSupabase();
  const shown = () => db.from('products').select('id', { count: 'exact', head: true })
    .eq('business_id', businessId).is('deleted_at', null).eq('show_on_website', true).gt('price', 0);
  const [biz, all, pictured] = await Promise.all([
    db.from('businesses').select('name, website_slug, contact_phone, contact_email, address').eq('id', businessId).single(),
    shown(),
    shown().not('image', 'is', null).neq('image', ''),
  ]);
  if (biz.error) throw biz.error;
  if (all.error) throw all.error;
  if (pictured.error) throw pictured.error;
  const b = biz.data as { name: string; website_slug: string | null; contact_phone: string | null; contact_email: string | null; address: string | null };
  return {
    name: b.name,
    slug: b.website_slug,
    phone: b.contact_phone?.trim() || null,
    email: b.contact_email?.trim() || null,
    address: b.address?.trim() || null,
    products: { shown: all.count ?? 0, withPicture: pictured.count ?? 0 },
  };
}

/** null while loading; `error` when the shop's facts could not be read (no score is guessed). */
export function useReadiness(): { readiness: Readiness | null; error: boolean } {
  const businessId = useWebsiteDraft((s) => s.businessId);
  const doc = useWebsiteDraft((s) => s.draft?.document);
  const revision = useWebsiteDraft((s) => s.draft?.revision);
  const [facts, setFacts] = useState<ShopFacts | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    loadShopFacts(businessId)
      .then((f) => { if (alive) { setFacts(f); setError(false); } })
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [businessId, revision]);

  const readiness = useMemo(() => {
    if (!facts || !doc) return null;
    return checkWebsite({
      name: facts.name,
      slug: facts.slug,
      primaryColor: doc.brand.primary_color,
      description: doc.brand.description,
      logoUrl: doc.brand.logo_url,
      brand: toPublicBrand(doc.brand),
      contact: { phone: facts.phone, email: facts.email, whatsapp: doc.contact.whatsapp, address: facts.address, hoursText: doc.contact.openingHours },
      products: facts.products,
      heroSlides: doc.heroSlides,
      adCards: doc.adCards,
      navigation: doc.navigation,
      seo: doc.seo,
      pages: doc.pages,
    });
  }, [facts, doc]);

  return { readiness, error };
}

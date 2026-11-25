import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchStorefront, storeSlug, switchMyStore } from './api';
import { hasStorePicker, loadStartingStore } from './stores';
import { applyBrand } from './engine/apply';
import { Route, startLinkInterceptor, useRoute } from './router';
import { startAuthListener, useAuth, useSite } from './store';
import { Loading, Notice, primaryButton } from './ui';
import { useHashScroll } from './router';
import { usePageMeta } from './usePageMeta';
import { useVisitCounter } from './useVisitCounter';
import Layout from './Layout';
import Assistant from './Assistant';
import PageEnd from './pages/PageEnd';
import HomePage from './pages/HomePage';
import ShopPage from './pages/ShopPage';
import ProductPage from './pages/ProductPage';
import CartPage from './pages/CartPage';
import ArticlesPage from './pages/ArticlesPage';
import FeedbackPage from './pages/FeedbackPage';
import ContactPage from './pages/ContactPage';
import AccountPage from './pages/AccountPage';
import { NewPasswordForm } from './pages/AuthForms';
import InfoPage from './pages/InfoPage';
import { NotFoundPage, OrderConfirmedPage, SavedPage, SitemapPage, TrackPage } from './pages/ExtraPages';
import { CheckoutPage } from './pages/CartPage';
import { ReviewsPage } from './pages/Reviews';
import IdeasPage from './pages/IdeasPage';
import { infoPage } from './infoPages';
import { AnnouncementBar, PopupAd } from './ads/AdSlots';
import { loadAds, trackAdConversion } from './ads/adStore';
import CampaignPage from './ads/CampaignPage';


startAuthListener();
startLinkInterceptor();

/** Pages with their own product sections or a task to finish, so they don't get the shared ending. */
const NO_PAGE_END = new Set(['', 'shop', 'search', 'products', 'cart', 'checkout', 'order-confirmed', 'account']);

function Page({ route }: { route: Route }) {
  const [section, id] = route.parts;
  const recovering = useAuth((s) => s.recovering);
  if (recovering) return <NewPasswordForm />;
  switch (section) {
    case undefined:
      return <HomePage />;
    case 'shop':
    case 'search':
      return <ShopPage route={route} />;
    case 'checkout':
      return <CheckoutPage />;
    case 'order-confirmed':
      return id ? <OrderConfirmedPage orderId={id} /> : <NotFoundPage />;
    case 'reviews':
      return <ReviewsPage />;
    case 'ideas':
      return <IdeasPage />;
    case 'products':
      return <ProductPage path={`/products/${id}`} />;
    case 'cart':
      return <CartPage />;
    case 'articles':
      return <ArticlesPage slug={id} />;
    case 'feedback':
      return <FeedbackPage />;
    case 'contact':
      return <ContactPage />;
    case 'account':
      return <AccountPage route={route.parts.slice(1)} />;
    case 'saved':
      return <SavedPage />;
    case 'track':
      return <TrackPage />;
    case 'sitemap':
      return <SitemapPage />;
    case 'promo':
      return id ? <CampaignPage address={id} /> : <NotFoundPage />;
    default: {
      const page = id === undefined ? infoPage(section) : undefined;
      return page ? <InfoPage page={page} /> : <NotFoundPage />;
    }
  }
}

export default function App() {
  const site = useSite((s) => s.site);
  const setSite = useSite((s) => s.setSite);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unpublished' | 'error'>('loading');
  const route = useRoute();
  const recovering = useAuth((s) => s.recovering);
  usePageMeta(route.parts, site);
  useVisitCounter(route.parts, status === 'ready' ? site?.business.slug ?? null : null);
  useHashScroll(route, status === 'ready');

  const load = async () => {
    setStatus('loading');
    try {
      // A brief network hiccup shouldn't show an error page, so try up to three times.
      let data: Awaited<ReturnType<typeof fetchStorefront>> = null;
      for (let attempt = 1; ; attempt++) {
        try {
          data = await loadStartingStore(fetchStorefront, storeSlug());
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
          await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
        }
      }
      if (!data) {
        setStatus('unpublished');
        return;
      }
      applyBrand(data);
      setSite(data);
      setStatus('ready');
      void loadAds();
    } catch (err) {
      console.error('Could not load storefront:', err);
      setStatus('error');
    }
  };

  useEffect(() => {
    load();
  }, []);

  // A signed-in customer's account follows the branch being shopped, so orders and points go there.
  const accountId = useAuth((s) => s.account?.id);
  const multiStore = hasStorePicker(site);
  useEffect(() => {
    if (accountId && multiStore) switchMyStore(storeSlug()).catch((err) => console.error('Could not move account to this store:', err));
  }, [accountId, multiStore]);

  // An order placed after clicking an advert counts for that advert (checked by the database).
  const confirmedOrder = route.parts[0] === 'order-confirmed' ? route.parts[1] : undefined;
  useEffect(() => {
    if (confirmedOrder) void trackAdConversion(confirmedOrder);
  }, [confirmedOrder]);

  if (status === 'loading') return <Loading />;
  if (status === 'unpublished') {
    return <Notice title="We'll be online soon" body="Our website isn't open yet. Please check back shortly." />;
  }
  if (status === 'error' || !site) {
    return (
      <Notice title="We couldn't load this page" body="Please check your connection and try again.">
        <button onClick={load} className={`${primaryButton} mt-6`}>
          <RefreshCw size={18} aria-hidden /> Try again
        </button>
      </Notice>
    );
  }

  return (
    <>
      <AnnouncementBar />
      <Layout section={route.parts[0] ?? ''} path={`/${route.parts.join('/')}${route.query.size ? `?${route.query}` : ''}`}>
        {/* Account tabs keep their shell, so only other page changes fade in. */}
        <div key={route.parts[0] === 'account' ? 'account' : route.parts.join('/')} className="page-enter">
          <Page route={route} />
          {!recovering && !NO_PAGE_END.has(route.parts[0] ?? '') && <PageEnd />}
        </div>
      </Layout>
      {site.settings.assistantEnabled && <Assistant />}
      <PopupAd section={route.parts[0] ?? ''} />
    </>
  );
}

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchStorefront, storeSlug, switchMyStore } from './api';
import { applyBrandColor, hasStorePicker, loadStartingStore } from './stores';
import { Route, startLinkInterceptor, useRoute } from './router';
import { startAuthListener, useAuth, useSite } from './store';
import { Loading, Notice, primaryButton } from './ui';
import { useHashScroll } from './router';
import { usePageMeta } from './usePageMeta';
import Layout from './Layout';
import Assistant from './Assistant';
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


startAuthListener();
startLinkInterceptor();

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
  usePageMeta(route.parts, site);
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
      applyBrandColor(data.business.primaryColor);
      setSite(data);
      setStatus('ready');
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
      <Layout section={route.parts[0] ?? ''} path={`/${route.parts.join('/')}${route.query.size ? `?${route.query}` : ''}`}>
        {/* Account tabs keep their shell, so only other page changes fade in. */}
        <div key={route.parts[0] === 'account' ? 'account' : route.parts.join('/')} className="page-enter">
          <Page route={route} />
        </div>
      </Layout>
      {site.settings.assistantEnabled && <Assistant />}
    </>
  );
}

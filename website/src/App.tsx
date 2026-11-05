import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchStorefront } from './api';
import { Route, startLinkInterceptor, useRoute } from './router';
import { startAuthListener, useAuth, useSite } from './store';
import { Loading, Notice, primaryButton } from './ui';
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

/** Applies the business's brand colour, keeping button text readable on it. */
function applyBrandColor(color: string | null) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  document.documentElement.style.setProperty('--brand-primary', color);
  document.documentElement.style.setProperty('--brand-on-primary', luminance > 0.55 ? '#1c1408' : '#ffffff');
}

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
      return <ShopPage initialQuery={route.query.get('q') ?? ''} />;
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
    default:
      return (
        <Notice title="We can't find that page" body="It may have been moved. Try our shop instead.">
          <a href="/shop" className={`${primaryButton} mt-6`}>Go to the shop</a>
        </Notice>
      );
  }
}

export default function App() {
  const site = useSite((s) => s.site);
  const setSite = useSite((s) => s.setSite);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unpublished' | 'error'>('loading');
  const route = useRoute();
  usePageMeta(route.parts, site);

  const load = async () => {
    setStatus('loading');
    try {
      const data = await fetchStorefront();
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
      <Layout section={route.parts[0] ?? ''}>
        <Page route={route} />
      </Layout>
      {site.settings.assistantEnabled && <Assistant />}
    </>
  );
}

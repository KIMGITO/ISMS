import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { onConsentChange, setStatsConsent, statsConsent, type StatsConsent } from './visitorCookies';
import {
  ArrowUp, Bell, ChevronDown, ChevronRight, Clock, Gift, Heart, Home, LayoutGrid, Lock, Mail, MapPin, Menu, MessageCircle, Minus, Phone, Plus,
  Search, ShoppingBag, ShoppingCart, Star, Store, Tag, Trash2, User, X,
} from 'lucide-react';
import { pointsOn } from './points';
import { INFO_PAGES } from './infoPages';
import { navigate } from './router';
import { fetchRewards, friendlyError, takesAirtel, WEBSITE_SLUG } from './api';
import { changeStore, hasStorePicker, storesOf } from './stores';
import { productPaths } from './seo';
import { external, isCurrentLink, menuLinks } from './engine/navigation';
import { leavePreview } from './api';
import { useAuth, useCart, usePanels, useSaved, useStorefront, useToast } from './store';
import { formatPrice, perUnit, ProductImage } from './ui';

const iconButton = 'relative grid size-11 place-items-center rounded-full text-ink transition hover:bg-sand';

const ACCOUNT_LINKS = [
  { href: '/account/orders', label: 'My orders' },
  { href: '/account/schedules', label: 'Regular orders' },
  { href: '/account/rewards', label: 'Rewards & points' },
  { href: '/account/messages', label: 'Messages' },
  { href: '/saved', label: 'Saved items' },
  { href: '/account/profile', label: 'Profile & settings' },
];

const HELP_LINKS = [
  ...INFO_PAGES.filter((p) => p.group === 'help').map((p) => ({ href: p.path, label: p.label })),
  { href: '/returns', label: 'Returns & refunds' },
  { href: '/track', label: 'Track an order' },
  { href: '/contact', label: 'Contact us' },
];

const COMPANY_LINKS = [
  { href: '/about', label: 'About us' },
  { href: '/reviews', label: 'Customer reviews' },
  { href: '/ideas', label: 'Vote & suggest products' },
  { href: '/articles', label: 'Guides' },
  { href: '/feedback', label: 'Give feedback' },
  { href: '/sitemap', label: 'Site map' },
];

const LEGAL_LINKS = INFO_PAGES.filter((p) => p.group === 'legal').map((p) => ({ href: p.path, label: p.label }));

const whatsappLink = (number: string) => `https://wa.me/${number.replace(/\D/g, '').replace(/^0/, '254')}`;

function useCategories() {
  const { products } = useStorefront();
  return Array.from(new Set(products.map((p) => p.category)));
}

function useCartCount() {
  const lines = useCart((s) => s.lines);
  const { products } = useStorefront();
  return lines.filter((l) => products.some((p) => p.id === l.productId)).length;
}

function useCartTotal() {
  const lines = useCart((s) => s.lines);
  const { products } = useStorefront();
  return lines.reduce((sum, l) => sum + (products.find((p) => p.id === l.productId)?.price ?? 0) * l.quantity, 0);
}

/** Closes on Escape, stops the page behind from scrolling, and moves focus into the panel. */
function useDrawer(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button, a, input')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

/** Search with a category picker and an ember Search button, as on the wide header. */
function SearchBox({ onSearch, autoFocus, withCategories = false, className = '' }: {
  onSearch?: () => void;
  autoFocus?: boolean;
  withCategories?: boolean;
  className?: string;
}) {
  const params = new URLSearchParams(window.location.search);
  const [term, setTerm] = useState(() => params.get('q') ?? '');
  const [category, setCategory] = useState(() => params.get('category') ?? '');
  const categories = useCategories();
  const { products, business } = useStorefront();
  const [open, setOpen] = useState(false);
  const paths = productPaths(products);
  // Matching products appear under the box as you type, like a shop's search suggestions.
  const needle = term.trim().toLowerCase();
  const suggestions = needle.length >= 2
    ? products
        .filter((p) => (!withCategories || !category || p.category === category) && `${p.name} ${p.category}`.toLowerCase().includes(needle))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)) || Number(b.inStock) - Number(a.inStock))
        .slice(0, 6)
    : [];
  const showList = open && suggestions.length > 0;
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setOpen(false);
    const query = new URLSearchParams();
    if (term.trim()) query.set('q', term.trim());
    if (withCategories && category) query.set('category', category);
    const text = query.toString();
    navigate(`/search${text ? `?${text}` : ''}`);
    onSearch?.();
  };
  return (
    <div
      className={`relative ${className}`}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    >
    <form role="search" onSubmit={handleSubmit} className="flex h-11 w-full overflow-hidden rounded-md border border-line bg-white focus-within:border-ember">
      {withCategories && categories.length > 1 && (
        <label className="relative hidden shrink-0 border-r border-line lg:block">
          <span className="sr-only">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-full max-w-44 appearance-none bg-transparent pl-4 pr-9 text-sm font-medium capitalize focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        </label>
      )}
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search products</span>
        <Search size={17} strokeWidth={1.8} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted md:hidden" aria-hidden />
        <input
          type="search"
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          aria-expanded={showList}
          aria-controls={showList ? 'search-suggestions' : undefined}
          autoComplete="off"
          placeholder="Search for products…"
          className="size-full bg-transparent pl-10 pr-3 text-base placeholder:text-muted/80 focus:outline-none md:pl-4 md:text-sm"
        />
      </label>
      <button type="submit" aria-label="Search" className="hidden shrink-0 items-center gap-2 bg-ember px-5 text-sm font-medium text-white transition hover:bg-brand-deep md:flex">
        <Search size={16} aria-hidden /> Search
      </button>
    </form>
    {showList && (
      <ul id="search-suggestions" aria-label="Suggested products" className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-soft">
        {suggestions.map((p) => (
          <li key={p.id}>
            <a href={paths.get(p.id)} onClick={() => { setOpen(false); onSearch?.(); }} className="flex items-center gap-3 px-3 py-2 hover:bg-shell focus:bg-shell focus:outline-none">
              <span className="size-10 shrink-0 overflow-hidden rounded-md border border-line bg-white"><ProductImage product={p} width={120} fit="contain" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block text-xs capitalize text-muted">{p.category}{p.inStock ? '' : ' · Sold out'}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-leaf">{formatPrice(business.currency, p.price)}</span>
            </a>
          </li>
        ))}
        <li className="border-t border-line">
          <button type="button" onClick={(e) => handleSubmit(e as unknown as FormEvent)} className="w-full px-3 py-2.5 text-left text-sm font-medium text-ember hover:bg-shell">
            See all results for “{term.trim()}”
          </button>
        </li>
      </ul>
    )}
    </div>
  );
}

/** The signed-in customer's points, for the badge in the header and tab bar. Null when hidden. */
function usePointsBadge(): number | null {
  const site = useStorefront();
  const account = useAuth((s) => s.account);
  const [points, setPoints] = useState<number | null>(null);
  const on = pointsOn(site);
  const slug = site.business.slug;
  useEffect(() => {
    if (!account || !on) {
      setPoints(null);
      return;
    }
    let live = true;
    fetchRewards()
      .then((r) => { if (live) setPoints(r && r.enabled !== false ? r.points : null); })
      .catch(() => { if (live) setPoints(null); });
    return () => { live = false; };
  }, [account?.id, on, slug]);
  return points;
}

/** The current branch on a button that opens the store picker. Only with two or more branches. */
function StoreButton({ compact = false }: { compact?: boolean }) {
  const site = useStorefront();
  const open = usePanels((s) => s.open);
  if (!hasStorePicker(site)) return null;
  if (compact) {
    return (
      <button onClick={() => open('store')} className="chip min-h-8 shrink-0 gap-1 border-ember/40 px-3 text-xs text-ink">
        <Store size={13} className="text-ember" aria-hidden /> {site.business.name} <ChevronDown size={13} aria-hidden />
      </button>
    );
  }
  return (
    <button onClick={() => open('store')} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition hover:bg-shell" aria-label={`Shopping at ${site.business.name}. Change store`}>
      <MapPin size={22} strokeWidth={1.6} className="shrink-0 text-ember" aria-hidden />
      <span className="min-w-0 leading-tight">
        <span className="block text-[0.6875rem] text-muted">Shopping at</span>
        <span className="flex items-center gap-1 text-sm font-medium"><span className="truncate">{site.business.name}</span> <ChevronDown size={14} className="shrink-0" aria-hidden /></span>
      </span>
    </button>
  );
}

function Header({ section, path }: { section: string; path: string }) {
  const site = useStorefront();
  const { business, settings } = site;
  const { name, logoUrl, contactPhone } = business;
  const account = useAuth((s) => s.account);
  const savedCount = useSaved((s) => s.ids.length);
  const count = useCartCount();
  const total = useCartTotal();
  const open = usePanels((s) => s.open);
  const points = usePointsBadge();
  const multiStore = hasStorePicker(site);
  const showPhoneSearch = ['', 'products', 'saved', 'articles'].includes(section);
  const badge = 'absolute -right-1.5 -top-1.5 grid min-w-[1.125rem] place-items-center rounded-full bg-ember px-1 text-[0.625rem] font-semibold leading-[1.125rem] text-white';

  const navLink = (active: boolean) =>
    `whitespace-nowrap py-3 text-sm font-medium transition hover:text-ember ${active ? 'text-ember' : 'text-ink'}`;
  const offers = site.products.some((p) => p.wasPrice && p.wasPrice > p.price);
  const menu = menuLinks(site.navigation, site.brand, offers);
  // The customer's saved delivery area, or else their estate/street.
  const myArea = account ? (site.deliveryZones.find((z) => z.id === account.delivery_zone_id)?.name || account.delivery_address || '') : '';

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      {/* Top row: logo, store, a big search, account and cart. */}
      <div className="site-gutter flex h-14 items-center gap-2 sm:h-16 sm:gap-4 lg:h-[4.75rem] lg:gap-6">
        <button onClick={() => open('menu')} aria-label="Open menu" className={`${iconButton} -ml-2.5 shrink-0 lg:hidden`}>
          <Menu strokeWidth={1.7} aria-hidden />
        </button>
        <a href="/" className="flex min-w-0 shrink-0 items-center gap-2" aria-label={`${name} home`}>
          <img src={logoUrl || '/logo.png'} alt="" width="36" height="36" className="size-8 shrink-0 rounded-full object-cover sm:size-9" />
          <span className="truncate text-lg font-semibold leading-none text-ember sm:text-[1.375rem]">{name}</span>
        </a>
        <div className="hidden max-w-56 shrink lg:block">
          {multiStore ? <StoreButton /> : (
            <a href={settings.deliveryEnabled && account ? '/account/profile' : '/delivery'} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-shell">
              <MapPin size={22} strokeWidth={1.6} className="shrink-0 text-ember" aria-hidden />
              <span className="min-w-0 leading-tight">
                <span className="block text-[0.6875rem] text-muted">{settings.deliveryEnabled ? 'Delivered to' : 'Pick up at'}</span>
                <span className="block truncate text-sm font-medium">{settings.deliveryEnabled ? myArea || (account ? 'Add your location' : 'Your area') : 'Our shop'}</span>
              </span>
            </a>
          )}
        </div>
        <SearchBox withCategories className="mx-auto hidden w-full max-w-2xl md:flex" />
        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0 lg:gap-4">
          <a href="/account" aria-label={account ? 'My account' : 'Sign in'} className={`${iconButton} lg:flex lg:w-auto lg:gap-2 lg:px-1 lg:hover:bg-transparent lg:hover:text-ember`}>
            <User size={21} strokeWidth={1.6} aria-hidden />
            <span className="hidden text-sm lg:inline">{account ? `Hi, ${account.name.split(' ')[0]}` : 'Sign in'}</span>
          </a>
          <a href="/saved" aria-label={savedCount ? `Saved items, ${savedCount}` : 'Saved items'} className={`${iconButton} hidden sm:grid`}>
            <span className="relative">
              <Heart size={21} strokeWidth={1.6} aria-hidden />
              {savedCount > 0 && <span className={badge}>{savedCount}</span>}
            </span>
          </a>
          <button onClick={() => open('cart')} aria-label={count ? `Cart, ${count} items` : 'Cart'} className={`${iconButton} lg:flex lg:w-auto lg:gap-2.5 lg:rounded-full lg:border lg:border-line lg:py-1.5 lg:pl-3 lg:pr-4 lg:hover:border-ember lg:hover:bg-white`}>
            <span className="relative">
              <ShoppingCart size={21} strokeWidth={1.6} aria-hidden />
              {count > 0 && <span key={count} className={`count-pop ${badge}`}>{count}</span>}
            </span>
            <span className="hidden text-left leading-tight lg:block">
              <span className="block text-[0.6875rem] text-muted">Cart</span>
              <span className="block text-sm font-semibold">{formatPrice(business.currency, total)}</span>
            </span>
          </button>
        </div>
      </div>

      {/* The grey bar: every category, the main pages, then store and points. */}
      <nav aria-label="Main" className="hidden border-t border-line bg-shell lg:block">
        <div className="site-gutter flex items-center gap-6">
          <button onClick={() => open('categories')} className="-ml-1 inline-flex h-11 items-center gap-2 bg-ember px-4 text-sm font-semibold text-white transition hover:bg-brand-deep">
            <Menu size={17} aria-hidden /> All categories
          </button>
          {menu.map((item) => {
            const current = isCurrentLink(item.href, path);
            return <a key={item.href + item.label} href={item.href} {...external(item.href)} aria-current={current ? 'page' : undefined} className={navLink(current)}>{item.label}</a>;
          })}
          <div className="ml-auto flex items-center gap-4">
            {multiStore && (
              <button onClick={() => open('store')} className="inline-flex h-11 items-center gap-1.5 text-sm font-medium hover:text-ember">
                <Store size={16} className="text-ember" aria-hidden /> Select store
              </button>
            )}
            {points !== null && (
              <a href="/account/rewards" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold ring-1 ring-line hover:ring-ember">
                <Gift size={15} className="text-ember" aria-hidden /> {points.toLocaleString('en-KE')} Points
              </a>
            )}
            {!multiStore && points === null && contactPhone && (
              <a href={`tel:${contactPhone.replace(/\s/g, '')}`} className="inline-flex h-11 items-center gap-1.5 text-sm font-medium hover:text-ember">
                <Phone size={15} className="text-ember" aria-hidden /> {contactPhone}
              </a>
            )}
          </div>
        </div>
      </nav>

      {showPhoneSearch && (
        <div className="site-gutter pb-2 md:hidden">
          <SearchBox />
        </div>
      )}
      {/* Phones, home page only: a short row of quick links, so other pages keep a short header. */}
      {section === '' && (
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2 lg:hidden">
        <StoreButton compact />
        {menu.filter((item) => item.href !== '/' && item.href !== '/shop').map((item) => (
          <a key={item.href + item.label} href={item.href} {...external(item.href)} className="chip min-h-8 shrink-0 px-3 text-xs">{item.label}</a>
        ))}
      </div>
      )}
    </header>
  );
}

/** "All Categories": a side panel listing every category with its picture and count. */
function CategoriesDrawer() {
  const { products } = useStorefront();
  const panel = usePanels((s) => s.panel);
  const close = usePanels((s) => s.close);
  const ref = useDrawer(panel === 'categories', close);
  if (panel !== 'categories') return null;
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const offers = products.filter((p) => p.wasPrice && p.wasPrice > p.price).length;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="All categories">
      <div className="drawer-backdrop absolute inset-0" onClick={close} />
      <div ref={ref} className="drawer-left absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col bg-white pt-[env(safe-area-inset-top)] shadow-2xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-lg font-semibold">All categories</span>
          <button onClick={close} aria-label="Close categories" className={iconButton}><X strokeWidth={1.7} aria-hidden /></button>
        </div>
        <ul className="flex-1 divide-y divide-line overflow-y-auto overscroll-contain px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <li>
            <a href="/shop" onClick={close} className="flex min-h-14 items-center gap-3 rounded-md px-2 font-medium hover:bg-shell hover:text-ember">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sand"><LayoutGrid size={18} aria-hidden /></span>
              <span className="flex-1">All products</span>
              <span className="text-sm text-muted">{products.length}</span>
            </a>
          </li>
          {offers > 0 && (
            <li>
              <a href="/shop?offers=1" onClick={close} className="flex min-h-14 items-center gap-3 rounded-md px-2 font-medium hover:bg-shell hover:text-ember">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ember text-white"><Tag size={17} aria-hidden /></span>
                <span className="flex-1">Offers</span>
                <span className="text-sm text-muted">{offers}</span>
              </a>
            </li>
          )}
          {Array.from(counts.entries()).map(([category, n]) => {
            const picture = products.find((p) => p.category === category && p.image);
            return (
              <li key={category}>
                <a href={`/shop?category=${encodeURIComponent(category)}`} onClick={close} className="flex min-h-14 items-center gap-3 rounded-md px-2 capitalize hover:bg-shell hover:text-ember">
                  <span className="size-10 shrink-0 overflow-hidden rounded-full border border-line bg-white">
                    <ProductImage product={picture ?? { name: category, image: null, category }} width={120} fit="contain" />
                  </span>
                  <span className="flex-1">{category}</span>
                  <span className="text-sm text-muted">{n}</span>
                  <ChevronRight size={17} className="text-muted" aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const ASKED_KEY = 'kaykays-store-asked';

/**
 * The store picker: each branch with its address and hours. Choosing one loads that branch's own
 * shop (products, prices, stock). Opens once by itself on a first visit when there are branches.
 */
function StorePicker() {
  const site = useStorefront();
  const panel = usePanels((s) => s.panel);
  const open = usePanels((s) => s.open);
  const close = usePanels((s) => s.close);
  const show = useToast((s) => s.show);
  const stores = storesOf(site);
  const current = site.business.slug ?? WEBSITE_SLUG;
  const [choice, setChoice] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isOpen = panel === 'store';
  const ref = useDrawer(isOpen, close);

  useEffect(() => {
    if (isOpen) { setChoice(current); setError(''); }
  }, [isOpen, current]);

  // A first visit to a shop with branches asks which one, like a shop asking for your area.
  useEffect(() => {
    if (stores.length < 2) return;
    let asked = true;
    try { asked = Boolean(localStorage.getItem(ASKED_KEY)); } catch { /* storage blocked: don't nag */ }
    if (asked) return;
    const timer = setTimeout(() => {
      if (!usePanels.getState().panel) open('store');
      try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* asked again next visit */ }
    }, 1500);
    return () => clearTimeout(timer);
  }, [stores.length, open]);

  if (!isOpen) return null;

  const confirm = async () => {
    if (choice === current) {
      close();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { dropped } = await changeStore(choice);
      close();
      const name = stores.find((s) => s.slug === choice)?.name ?? 'the new store';
      show(dropped > 0
        ? `Now at ${name}. ${dropped} ${dropped === 1 ? 'item' : 'items'} not sold here left your cart.`
        : `Now shopping at ${name}.`);
    } catch (err) {
      setError(friendlyError(err, 'We couldn\'t switch store. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="store-picker-title">
      <div className="drawer-backdrop absolute inset-0" onClick={close} />
      <div ref={ref} className="rise-in relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div>
            <h2 id="store-picker-title" className="text-lg font-semibold">Choose your store</h2>
            <p className="mt-0.5 text-sm text-muted">Each branch has its own prices and stock. Your order is prepared there.</p>
          </div>
          <button onClick={close} aria-label="Close" className={`${iconButton} -mr-2 -mt-1 shrink-0`}><X strokeWidth={1.7} aria-hidden /></button>
        </div>
        <ul className="flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-5">
          {stores.map((store) => {
            const selected = choice === store.slug;
            return (
              <li key={store.slug}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${selected ? 'border-ember bg-amber-50' : 'border-line hover:border-ink/40'}`}>
                  <input type="radio" name="store" className="mt-1 size-4 accent-[var(--color-ember)]" checked={selected} onChange={() => setChoice(store.slug)} />
                  <img src={store.logoUrl || '/logo.png'} alt="" className="size-11 shrink-0 rounded-full border border-line object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {store.name}
                      {store.slug === current && <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-leaf">Current</span>}
                    </span>
                    {store.address && <span className="mt-0.5 flex items-start gap-1.5 text-sm text-muted"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden /> {store.address}</span>}
                    {store.openingHours && <span className="mt-0.5 flex items-start gap-1.5 text-sm text-muted"><Clock size={14} className="mt-0.5 shrink-0" aria-hidden /> <span className="whitespace-pre-line">{store.openingHours}</span></span>}
                    {store.phone && <span className="mt-0.5 flex items-start gap-1.5 text-sm text-muted"><Phone size={14} className="mt-0.5 shrink-0" aria-hidden /> {store.phone}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="space-y-2 border-t border-line p-5">
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={confirm} disabled={busy} className="btn btn-primary">{busy ? 'Switching…' : choice === current ? 'Continue' : 'Shop at this store'}</button>
            <button onClick={close} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DrawerLinks({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div className="border-t border-line py-4">
      <h3 className="eyebrow px-1">{title}</h3>
      <ul className="mt-1">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="flex min-h-11 items-center justify-between rounded-md px-1 text-sm capitalize hover:bg-shell hover:text-ember">
              {link.label} <ChevronRight size={17} className="text-muted" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenuDrawer() {
  const site = useStorefront();
  const { business, settings } = site;
  const panel = usePanels((s) => s.panel);
  const close = usePanels((s) => s.close);
  const account = useAuth((s) => s.account);
  const categories = useCategories();
  const ref = useDrawer(panel === 'menu', close);
  if (panel !== 'menu') return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="drawer-backdrop absolute inset-0" onClick={close} />
      <div ref={ref} className="drawer-left absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col bg-white pt-[env(safe-area-inset-top)] shadow-2xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-xl font-semibold text-ember">{business.name}</span>
          <button onClick={close} aria-label="Close menu" className={iconButton}><X strokeWidth={1.7} aria-hidden /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <a href="/account" className="my-4 flex items-center gap-3 rounded-xl bg-sand p-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white"><User size={20} aria-hidden /></span>
            <span className="min-w-0">
              <span className="block font-medium">{account ? `Hello, ${account.name.split(' ')[0]}` : 'Sign in or create an account'}</span>
              <span className="block text-sm text-muted">{account ? 'Orders, rewards and messages' : pointsOn(site) ? 'Track orders and earn points' : 'Track your orders'}</span>
            </span>
          </a>
          {hasStorePicker(site) && (
            <button onClick={() => usePanels.getState().open('store')} className="mb-4 flex w-full items-center gap-3 rounded-xl border border-line p-3.5 text-left">
              <Store size={20} className="shrink-0 text-ember" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted">Shopping at</span>
                <span className="block truncate font-medium">{business.name}</span>
              </span>
              <span className="text-sm font-medium text-ember">Change</span>
            </button>
          )}
          <DrawerLinks
            title="Shop"
            links={[{ href: '/shop', label: 'All products' }, ...categories.map((c) => ({ href: `/shop?category=${encodeURIComponent(c)}`, label: c }))]}
          />
          <DrawerLinks title="My account" links={ACCOUNT_LINKS} />
          <DrawerLinks title="Help" links={HELP_LINKS} />
          <DrawerLinks title={business.name} links={COMPANY_LINKS} />
          <div className="space-y-1 border-t border-line pt-4">
            {business.contactPhone && (
              <a href={`tel:${business.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 items-center gap-3 px-1 font-medium">
                <Phone size={18} className="text-ember" aria-hidden /> {business.contactPhone}
              </a>
            )}
            {(settings.whatsapp || business.contactPhone) && (
              <a href={whatsappLink(settings.whatsapp || business.contactPhone!)} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-3 px-1 font-medium">
                <MessageCircle size={18} className="text-ember" aria-hidden /> WhatsApp us
              </a>
            )}
          </div>
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 px-1 text-sm text-muted">
            {LEGAL_LINKS.map((link) => <a key={link.href} href={link.href} className="py-1 hover:text-ink">{link.label}</a>)}
          </p>
        </div>
      </div>
    </div>
  );
}

function CartDrawer() {
  const site = useStorefront();
  const { products, business, settings } = site;
  const { lines, setQuantity, remove } = useCart();
  const panel = usePanels((s) => s.panel);
  const close = usePanels((s) => s.close);
  const ref = useDrawer(panel === 'cart', close);
  if (panel !== 'cart') return null;

  const paths = productPaths(products);
  const rows = lines
    .map((line) => ({ line, product: products.find((p) => p.id === line.productId) }))
    .filter((row): row is { line: typeof row.line; product: NonNullable<typeof row.product> } => Boolean(row.product));
  const subtotal = rows.reduce((sum, { line, product }) => sum + product.price * line.quantity, 0);
  const shortBy = Number(settings.minOrder) - subtotal;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your cart">
      <div className="drawer-backdrop absolute inset-0" onClick={close} />
      <div ref={ref} className="drawer-right absolute inset-y-0 right-0 flex w-[min(26rem,100vw)] flex-col bg-white pt-[env(safe-area-inset-top)] shadow-2xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-lg font-medium">Your cart {rows.length > 0 && <span className="font-normal text-muted">({rows.length})</span>}</h2>
          <button onClick={close} aria-label="Close cart" className={`${iconButton} -mr-2`}><X strokeWidth={1.7} aria-hidden /></button>
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-sand"><ShoppingBag size={28} strokeWidth={1.5} aria-hidden /></span>
            <p className="text-lg font-medium">Your cart is empty</p>
            <p className="text-muted">Everything you need is a few taps away.</p>
            <a href="/shop" onClick={close} className="btn btn-primary">Start shopping</a>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-line overflow-y-auto overscroll-contain px-5">
              {rows.map(({ line, product }) => (
                <li key={product.id} className="flex gap-3 py-4">
                  <a href={paths.get(product.id)} onClick={close} className="size-20 shrink-0 overflow-hidden rounded-md bg-shell">
                    <ProductImage product={product} width={200} />
                  </a>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <a href={paths.get(product.id)} onClick={close} className="line-clamp-2 text-sm font-medium leading-snug hover:text-ember">{product.name}</a>
                      <button onClick={() => remove(product.id)} aria-label={`Remove ${product.name}`} className="-mr-2 -mt-2 grid size-10 shrink-0 place-items-center text-muted hover:text-red-700">
                        <Trash2 size={17} aria-hidden />
                      </button>
                    </div>
                    <p className="text-sm text-muted">{formatPrice(business.currency, product.price)} / {perUnit(product.unit)}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center rounded-full border border-line">
                        <button
                          aria-label={`Less ${product.name}`}
                          onClick={() => setQuantity(product.id, Math.max(0.5, line.quantity - (line.quantity > 1 ? 1 : 0.5)))}
                          className="grid size-9 place-items-center"
                        >
                          <Minus size={15} aria-hidden />
                        </button>
                        <span className="min-w-8 text-center text-sm font-semibold" aria-live="polite">{line.quantity}</span>
                        <button aria-label={`More ${product.name}`} onClick={() => setQuantity(product.id, line.quantity + 1)} className="grid size-9 place-items-center">
                          <Plus size={15} aria-hidden />
                        </button>
                      </div>
                      <p className="font-semibold text-leaf">{formatPrice(business.currency, product.price * line.quantity)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="shrink-0 space-y-3 border-t border-line p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <div className="flex justify-between text-lg font-semibold">
                <span>Subtotal</span>
                <span>{formatPrice(business.currency, subtotal)}</span>
              </div>
              <p className="text-sm text-muted">
                {shortBy > 0
                  ? `Add ${formatPrice(business.currency, shortBy)} more to reach the minimum order.`
                  : pointsOn(site) ? 'Delivery, if any, and points are worked out at checkout.' : 'Delivery, if any, is worked out at checkout.'}
              </p>
              <a href="/cart" onClick={close} className="btn btn-accent w-full">Checkout</a>
              <button onClick={close} className="btn btn-secondary w-full">Continue shopping</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Phones: Home, Category, Points (or Saved), Account and Cart along the bottom. */
function TabBar({ section }: { section: string }) {
  const site = useStorefront();
  const count = useCartCount();
  const savedCount = useSaved((s) => s.ids.length);
  const open = usePanels((s) => s.open);
  const panel = usePanels((s) => s.panel);
  const points = usePointsBadge();
  const item = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold';
  const tone = (active: boolean) => (active ? 'text-ember' : 'text-muted');
  const showPoints = pointsOn(site);

  return (
    <nav aria-label="Shortcuts" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgb(111_111_111/0.1)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg">
        <a href="/" aria-current={section === '' ? 'page' : undefined} className={`${item} ${tone(section === '')}`}>
          <Home size={22} strokeWidth={section === '' ? 2.1 : 1.7} aria-hidden /> Home
        </a>
        <button onClick={() => open('categories')} className={`${item} ${tone(panel === 'categories' || section === 'shop')}`}>
          <LayoutGrid size={22} strokeWidth={1.7} aria-hidden /> Category
        </button>
        {showPoints ? (
          <a href="/account/rewards" aria-current={section === 'account' && window.location.pathname.startsWith('/account/rewards') ? 'page' : undefined} className={`${item} ${tone(window.location.pathname.startsWith('/account/rewards'))}`}>
            <span className="grid size-[1.375rem] place-items-center rounded-full bg-ember text-white"><Gift size={13} aria-hidden /></span>
            {points !== null ? `${points.toLocaleString('en-KE')} Pts` : 'Points'}
          </a>
        ) : (
          <a href="/saved" aria-current={section === 'saved' ? 'page' : undefined} className={`${item} ${tone(section === 'saved')}`}>
            <span className="relative">
              <Heart size={22} strokeWidth={section === 'saved' ? 2.1 : 1.7} aria-hidden />
              {savedCount > 0 && <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-ember" />}
            </span>
            Saved
          </a>
        )}
        <a href="/account" aria-current={section === 'account' ? 'page' : undefined} className={`${item} ${tone(section === 'account' && !window.location.pathname.startsWith('/account/rewards'))}`}>
          <User size={22} strokeWidth={section === 'account' ? 2.1 : 1.7} aria-hidden /> Account
        </a>
        <button onClick={() => open('cart')} className={`${item} ${tone(panel === 'cart' || section === 'cart')}`} aria-label={count ? `Cart, ${count} items` : 'Cart'}>
          <span className="relative">
            <ShoppingBag size={22} strokeWidth={1.7} aria-hidden />
            {count > 0 && (
              <span key={count} className="count-pop absolute -right-2.5 -top-1.5 grid min-w-[1.125rem] place-items-center rounded-full bg-ember px-1 text-[0.625rem] font-semibold leading-[1.125rem] text-white">
                {count}
              </span>
            )}
          </span>
          Cart
        </button>
      </div>
    </nav>
  );
}

function CartToast() {
  const { message, id, hide } = useToast();
  const open = usePanels((s) => s.open);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(hide, 3500);
    return () => clearTimeout(timer);
  }, [message, id, hide]);
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+var(--float-offset,0px)+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-auto lg:top-28 lg:justify-end lg:px-8">
      <div key={id} role="status" className="toast-enter pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg bg-ink p-3 pl-4 text-cream shadow-2xl">
        <p className="min-w-0 flex-1 text-sm font-medium">{message}</p>
        <button onClick={() => { hide(); open('cart'); }} className="shrink-0 rounded-full bg-cream px-4 py-2 text-sm font-semibold text-ink hover:bg-white">
          View cart
        </button>
      </div>
    </div>
  );
}

/**
 * Asks once whether statistics cookies may be used (visitorCookies.ts). Needed storage (cart,
 * sign-in) needs no consent; statistics cookies do, so nothing is set until "Allow". The
 * cookies page always shows it, so the answer can be changed there.
 */
function StorageNotice() {
  const onCookiesPage = typeof location !== 'undefined' && location.pathname.replace(/\/$/, '') === '/cookies';
  const [answer, setAnswer] = useState<StatsConsent>(() => statsConsent());
  useEffect(() => onConsentChange(setAnswer), []);
  if (answer !== null && !onCookiesPage) return null;
  const choose = (a: 'yes' | 'no') => setStatsConsent(a);
  return (
    <div role="dialog" aria-label="Cookies" className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl rounded-lg border border-line bg-white p-3.5 shadow-2xl lg:bottom-6 lg:left-6 lg:right-auto lg:mx-0">
      <p className="text-xs leading-relaxed text-muted sm:text-sm">
        We save your cart and sign-in on this device. With your OK we also use statistics cookies to see
        how visitors use the shop, never for adverts.{' '}
        <a href="/cookies" className="font-medium text-ink underline">Learn more</a>
        {answer && <span className="block pt-1 text-ink">Your choice: {answer === 'yes' ? 'statistics allowed' : 'needed only'}.</span>}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => choose('yes')} className="btn btn-primary btn-sm">Allow statistics</button>
        <button onClick={() => choose('no')} className="btn btn-sm border border-line bg-white text-ink">Needed only</button>
      </div>
    </div>
  );
}

function FooterLinks({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  const list = (
    <ul className="space-y-0.5 pb-3 lg:mt-3 lg:pb-0">
      {links.map((link) => (
        <li key={link.href}>
          <a href={link.href} className="inline-block py-1 text-sm capitalize text-muted transition hover:text-ember">{link.label}</a>
        </li>
      ))}
    </ul>
  );
  return (
    <nav aria-label={title}>
      {/* Folds up on phones so the footer stays short; always open on wide screens. */}
      <details className="accordion border-b border-line lg:hidden">
        <summary className="flex min-h-12 items-center justify-between py-2 text-sm font-medium">
          {title} <ChevronDown size={17} className="accordion-icon text-muted" aria-hidden />
        </summary>
        {list}
      </details>
      <div className="hidden lg:block">
        <h3 className="text-[0.9375rem] font-medium">{title}</h3>
        {list}
      </div>
    </nav>
  );
}

function FooterRating() {
  const { reviews = [] } = useStorefront();
  const count = reviews.length;
  const average = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;
  return (
    <a href="/reviews" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
      <span className="flex text-star" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill={n <= Math.round(average) ? 'currentColor' : 'none'} strokeWidth={1.5} />)}
      </span>
      {count ? <span><strong className="font-medium text-ink">{average.toFixed(1)}</strong> from {count} {count === 1 ? 'review' : 'reviews'}</span> : 'Be the first to review us'}
    </a>
  );
}

/** A light footer: offers sign-up, the shop, contact details, then the link lists and legal line. */
function Footer() {
  const site = useStorefront();
  const { business, settings } = site;
  const account = useAuth((s) => s.account);
  const categories = useCategories().slice(0, 5);
  const whatsapp = settings.whatsapp || business.contactPhone;
  const round = 'grid size-9 place-items-center rounded-full border border-line bg-white text-ember transition hover:border-ember hover:bg-ember hover:text-white';
  const contactIcon = 'grid size-9 shrink-0 place-items-center rounded-full bg-tint-peach text-ember';

  return (
    <footer className="mt-12 border-t border-line bg-shell sm:mt-16">
      <div className="site-gutter">
        <div className="grid gap-8 py-10 sm:py-12 lg:grid-cols-3 lg:gap-12">
          <div className="lg:order-2 lg:text-center">
            <a href="/" className="inline-flex items-center gap-2.5">
              <img src={business.logoUrl || '/logo.png'} alt="" width="40" height="40" className="size-10 rounded-full object-cover" />
              <span className="text-2xl font-semibold text-ember">{business.name}</span>
            </a>
            <p className="mt-3 text-sm leading-relaxed text-muted max-sm:line-clamp-2 lg:mx-auto lg:max-w-xs">
              {business.description || 'Order online and pay with M-Pesa.'}
            </p>
            <div className="mt-4 flex gap-2 lg:justify-center">
              {business.contactPhone && (
                <a href={`tel:${business.contactPhone.replace(/\s/g, '')}`} aria-label="Call us" className={round}><Phone size={15} aria-hidden /></a>
              )}
              {whatsapp && (
                <a href={whatsappLink(whatsapp)} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp us" className={round}><MessageCircle size={15} aria-hidden /></a>
              )}
              {business.contactEmail && (
                <a href={`mailto:${business.contactEmail}`} aria-label="Email us" className={round}><Mail size={15} aria-hidden /></a>
              )}
            </div>
            <div className="mt-4"><FooterRating /></div>
          </div>

          <div className="lg:order-1">
            <h3 className="text-[0.9375rem] font-medium">Our offers</h3>
            <p className="mt-2 max-w-xs text-sm text-muted max-sm:hidden">Hear about offers first. Switch messages off any time.</p>
            <a href="/account/profile" className="btn btn-primary mt-4">
              <Bell size={15} aria-hidden /> {account ? 'Choose messages' : 'Sign up for offers'}
            </a>
          </div>

          <ul className="space-y-3 text-sm text-muted lg:order-3">
            {business.contactPhone && (
              <li className="flex items-center gap-3"><span className={contactIcon}><Phone size={15} aria-hidden /></span> Call us: {business.contactPhone}</li>
            )}
            {business.address && (
              <li className="flex items-center gap-3"><span className={contactIcon}><MapPin size={15} aria-hidden /></span> {business.address}</li>
            )}
            {business.contactEmail && (
              <li className="flex items-center gap-3"><span className={contactIcon}><Mail size={15} aria-hidden /></span> <span className="min-w-0 break-all">{business.contactEmail}</span></li>
            )}
            {settings.openingHours && (
              <li className="flex items-center gap-3"><span className={contactIcon}><Clock size={15} aria-hidden /></span> <span className="whitespace-pre-line">{settings.openingHours}</span></li>
            )}
          </ul>
        </div>

        <div className="grid border-t border-line lg:grid-cols-4 lg:gap-8 lg:py-10">
          <FooterLinks
            title="Shop"
            links={[{ href: '/shop', label: 'All products' }, ...categories.map((c) => ({ href: `/shop?category=${encodeURIComponent(c)}`, label: c })), { href: '/saved', label: 'Saved items' }, { href: '/cart', label: 'Cart' }]}
          />
          <FooterLinks title="Customer care" links={HELP_LINKS} />
          <FooterLinks title="My account" links={[{ href: '/account', label: account ? 'My account' : 'Sign in / Register' }, ...ACCOUNT_LINKS.slice(0, 4)]} />
          <FooterLinks title="Company" links={COMPANY_LINKS} />
        </div>

        <div className="flex flex-col gap-3 border-t border-line py-5 text-xs text-muted lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>© {new Date().getFullYear()} {business.name}</span>
            {LEGAL_LINKS.map((link) => <a key={link.href} href={link.href} className="py-1 hover:text-ink">{link.label}</a>)}
            <a href="/sitemap" className="py-1 hover:text-ink">Site map</a>
            <span className="py-1" title="Website version">v{__SITE_VERSION__}</span>
            {site.site?.poweredBy && (site.site.platformName || site.site.platformUrl) && (
              site.site.platformUrl ? (
                <a href={site.site.platformUrl} target="_blank" rel="noopener" className="py-1 hover:text-ink">
                  Powered by {site.site.platformName || site.site.platformUrl.replace(/^https:\/\//, '')}
                </a>
              ) : (
                <span className="py-1">Powered by {site.site.platformName}</span>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><Lock size={13} aria-hidden /> Secure payments</span>
            <span className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-[#2f8a3b] ring-1 ring-line">M-Pesa</span>
            {takesAirtel(site) && <span className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-[#e40000] ring-1 ring-line">Airtel Money</span>}
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top" className="grid size-9 place-items-center rounded-full border border-line bg-white hover:border-ink">
              <ArrowUp size={15} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Shown only on a preview link from the app: what is seen here is not live yet. */
function PreviewBar() {
  const { site } = useStorefront();
  if (!site?.preview) return null;
  return (
    <div role="status" className="site-gutter flex flex-wrap items-center justify-between gap-2 bg-ink py-2 text-sm text-white">
      <span>Preview of unpublished changes. Visitors do not see this yet, and orders are off.</span>
      <button type="button" onClick={leavePreview} className="min-h-9 rounded-md px-3 font-medium underline underline-offset-2 hover:bg-white/10">
        Leave preview
      </button>
    </div>
  );
}

export default function Layout({ section, path, children }: { section: string; path: string; children: ReactNode }) {
  const close = usePanels((s) => s.close);
  useEffect(() => close(), [path, close]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-lg bg-ink px-4 py-3 text-cream focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <PreviewBar />
      <Header section={section} path={path} />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
      <TabBar section={section} />
      <MenuDrawer />
      <CategoriesDrawer />
      <StorePicker />
      <CartDrawer />
      <CartToast />
      <StorageNotice />
    </div>
  );
}

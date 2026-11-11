import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Bell, ChevronDown, ChevronRight, Clock, Heart, Home, LayoutGrid, Lock, Mail, MapPin, Menu, MessageCircle, Minus, Phone, Plus,
  Search, ShoppingBag, ShoppingCart, Star, Trash2, User, X,
} from 'lucide-react';
import { pointsOn } from './api';
import { CREDITED_PHOTOS } from './images';
import { INFO_PAGES } from './infoPages';
import { navigate } from './router';
import { productPaths } from './seo';
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
  { href: '/articles', label: 'Milk guides' },
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
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const query = new URLSearchParams();
    if (term.trim()) query.set('q', term.trim());
    if (withCategories && category) query.set('category', category);
    const text = query.toString();
    navigate(`/search${text ? `?${text}` : ''}`);
    onSearch?.();
  };
  return (
    <form role="search" onSubmit={handleSubmit} className={`flex h-11 overflow-hidden rounded-md border border-line bg-white focus-within:border-ember ${className}`}>
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
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search for products…"
          className="size-full bg-transparent pl-10 pr-3 text-base placeholder:text-muted/80 focus:outline-none md:pl-4 md:text-sm"
        />
      </label>
      <button type="submit" aria-label="Search" className="hidden shrink-0 items-center gap-2 bg-ember px-5 text-sm font-medium text-white transition hover:bg-brand-deep md:flex">
        <Search size={16} aria-hidden /> Search
      </button>
    </form>
  );
}

/** The thin top bar: quick links on wide screens, one short line on phones. */
function UtilityBar() {
  const { settings, deliveryZones } = useStorefront();
  const account = useAuth((s) => s.account);
  const freeDelivery = settings.deliveryEnabled && deliveryZones.length === 0 && Number(settings.deliveryFee) === 0;
  const link = 'whitespace-nowrap px-3 py-2 transition hover:text-ember';
  return (
    <div className="border-b border-line bg-white text-xs text-muted">
      <div className="site-gutter flex min-h-9 items-center justify-center gap-4 sm:justify-between">
        <p className="font-medium text-ink sm:hidden">Order online · Pay with M-Pesa</p>
        <nav aria-label="About" className="-ml-3 hidden items-center divide-x divide-line sm:flex">
          <a href="/about" className={link}>About us</a>
          <a href="/delivery" className={link}>{freeDelivery ? 'Free delivery' : settings.deliveryEnabled ? 'Delivery' : 'Pickup'}</a>
          <a href="/returns" className={link}>Returns policy</a>
        </nav>
        <nav aria-label="Quick links" className="-mr-3 hidden items-center divide-x divide-line sm:flex">
          <a href="/help" className={link}>Help centre</a>
          <a href="/track" className={link}>Track order</a>
          <a href="/account" className={link}>{account ? 'My account' : 'Sign in'}</a>
        </nav>
      </div>
    </div>
  );
}

function Header({ section, path }: { section: string; path: string }) {
  const { business, settings } = useStorefront();
  const { name, logoUrl, contactPhone } = business;
  const savedCount = useSaved((s) => s.ids.length);
  const count = useCartCount();
  const open = usePanels((s) => s.open);
  const categories = useCategories();
  const activeCategory = section === 'shop' ? new URLSearchParams(window.location.search).get('category') : null;
  const showPhoneSearch = ['', 'products', 'saved', 'articles'].includes(section);
  const badge = 'absolute -right-1.5 -top-1.5 grid min-w-[1.125rem] place-items-center rounded-full bg-ember px-1 text-[0.625rem] font-semibold leading-[1.125rem] text-white';
  const labelled = 'lg:flex lg:w-auto lg:gap-2 lg:px-1 lg:hover:bg-transparent lg:hover:text-ember';

  const navLink = (active: boolean) =>
    `whitespace-nowrap py-3.5 text-sm font-medium transition hover:text-ember ${active ? 'text-ember' : 'text-ink'}`;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="site-gutter flex h-14 items-center gap-2 sm:h-16 sm:gap-4 lg:h-[4.75rem] lg:gap-8">
        <button onClick={() => open('menu')} aria-label="Open menu" className={`${iconButton} -ml-2.5 shrink-0 lg:hidden`}>
          <Menu strokeWidth={1.7} aria-hidden />
        </button>
        <a href="/" className="flex min-w-0 shrink-0 items-center gap-2" aria-label={`${name} home`}>
          <img src={logoUrl || '/logo.png'} alt="" width="36" height="36" className="size-8 shrink-0 rounded-full object-cover sm:size-9" />
          <span className="truncate text-lg font-semibold leading-none text-ember sm:text-[1.375rem]">{name}</span>
        </a>
        <SearchBox withCategories className="mx-auto hidden w-full max-w-2xl md:flex" />
        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0 lg:gap-5">
          <a href="/delivery" className="hidden items-center gap-2 xl:flex">
            <MapPin size={22} strokeWidth={1.6} className="text-ember" aria-hidden />
            <span className="leading-tight">
              <span className="block text-[0.6875rem] text-muted">{settings.deliveryEnabled ? 'Delivered to' : 'Pick up at'}</span>
              <span className="block text-sm font-medium">{settings.deliveryEnabled ? 'Your area' : 'Our shop'}</span>
            </span>
          </a>
          <a href="/saved" aria-label={savedCount ? `Saved items, ${savedCount}` : 'Saved items'} className={`${iconButton} hidden sm:grid ${labelled}`}>
            <span className="relative">
              <Heart size={21} strokeWidth={1.6} aria-hidden />
              {savedCount > 0 && <span className={badge}>{savedCount}</span>}
            </span>
            <span className="hidden text-sm lg:inline">Saved</span>
          </a>
          <a href="/account" aria-label="My account" className={`${iconButton} lg:hidden`}>
            <User size={21} strokeWidth={1.6} aria-hidden />
          </a>
          <button onClick={() => open('cart')} aria-label={count ? `Cart, ${count} items` : 'Cart'} className={`${iconButton} ${labelled}`}>
            <span className="relative">
              <ShoppingCart size={21} strokeWidth={1.6} aria-hidden />
              {count > 0 && <span key={count} className={`count-pop ${badge}`}>{count}</span>}
            </span>
            <span className="hidden text-sm lg:inline">Cart</span>
          </button>
        </div>
      </div>

      <nav aria-label="Main" className="hidden border-t border-line lg:block">
        <div className="site-gutter flex items-center gap-7">
          <a href="/" aria-current={section === '' ? 'page' : undefined} className={navLink(section === '')}>Home</a>
          <a href="/shop" aria-current={section === 'shop' && !activeCategory ? 'page' : undefined} className={navLink(section === 'shop' && !activeCategory)}>Shop</a>
          {categories.slice(0, 4).map((category) => (
            <a
              key={category}
              href={`/shop?category=${encodeURIComponent(category)}`}
              aria-current={activeCategory === category ? 'page' : undefined}
              className={`${navLink(activeCategory === category)} capitalize`}
            >
              {category}
            </a>
          ))}
          <a href="/account/schedules" className={navLink(path.startsWith('/account/schedules'))}>Regular orders</a>
          <a href="/articles" aria-current={section === 'articles' ? 'page' : undefined} className={navLink(section === 'articles')}>Guides</a>
          <a href="/contact" aria-current={section === 'contact' ? 'page' : undefined} className={navLink(section === 'contact')}>Contact</a>
          {contactPhone && (
            <a href={`tel:${contactPhone.replace(/\s/g, '')}`} className="ml-auto inline-flex h-10 items-center gap-2 rounded-md bg-ember px-4 text-sm font-medium text-white transition hover:bg-brand-deep">
              <Phone size={15} aria-hidden /> {contactPhone}
            </a>
          )}
        </div>
      </nav>

      {showPhoneSearch && (
        <div className="site-gutter pb-2.5 md:hidden">
          <SearchBox />
        </div>
      )}
    </header>
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
            <p className="text-muted">Fresh milk is a few taps away.</p>
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

function TabBar({ section }: { section: string }) {
  const count = useCartCount();
  const savedCount = useSaved((s) => s.ids.length);
  const open = usePanels((s) => s.open);
  const panel = usePanels((s) => s.panel);
  const item = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold';
  const tone = (active: boolean) => (active ? 'text-ember' : 'text-muted');
  const tabs = [
    { href: '/', label: 'Home', icon: Home, active: section === '' },
    { href: '/shop', label: 'Shop', icon: LayoutGrid, active: section === 'shop' || section === 'products' },
    { href: '/saved', label: 'Saved', icon: Heart, active: section === 'saved', badge: savedCount },
  ];

  return (
    <nav aria-label="Shortcuts" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg">
        {tabs.map(({ href, label, icon: Icon, active, badge }) => (
          <a key={href} href={href} aria-current={active ? 'page' : undefined} className={`${item} ${tone(active)}`}>
            <span className="relative">
              <Icon size={22} strokeWidth={active ? 2.1 : 1.7} aria-hidden />
              {Boolean(badge) && <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-ember" />}
            </span>
            {label}
          </a>
        ))}
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
        <a href="/account" aria-current={section === 'account' ? 'page' : undefined} className={`${item} ${tone(section === 'account')}`}>
          <User size={22} strokeWidth={section === 'account' ? 2.1 : 1.7} aria-hidden />
          Account
        </a>
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

const NOTICE_KEY = 'kaykays-storage-notice';

/** This site only stores what it needs to work, so this tells rather than asks. */
function StorageNotice() {
  const [show, setShow] = useState(() => {
    try { return !localStorage.getItem(NOTICE_KEY); } catch { return false; }
  });
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* shown again next visit */ }
    setShow(false);
  };
  return (
    <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl rounded-lg border border-line bg-white p-3.5 shadow-2xl lg:bottom-6 lg:left-6 lg:right-auto lg:mx-0">
      <p className="text-xs leading-relaxed text-muted sm:text-sm">
        We save your cart and sign-in on this device. No tracking cookies.{' '}
        <a href="/cookies" className="font-medium text-ink underline">Learn more</a>
      </p>
      <button onClick={dismiss} className="btn btn-primary btn-sm mt-3 w-full sm:w-auto">OK</button>
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
  const { business, settings } = useStorefront();
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
              {business.description || 'Fresh milk and dairy, ordered online and paid with M-Pesa.'}
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
              <li className="flex items-center gap-3"><span className={contactIcon}><Clock size={15} aria-hidden /></span> {settings.openingHours}</li>
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
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><Lock size={13} aria-hidden /> Secure payments</span>
            <span className="rounded bg-white px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-[#2f8a3b] ring-1 ring-line">M-PESA</span>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top" className="grid size-9 place-items-center rounded-full border border-line bg-white hover:border-ink">
              <ArrowUp size={15} aria-hidden />
            </button>
          </div>
        </div>
        <details className="pb-5 text-xs text-muted/80">
          <summary className="cursor-pointer py-1">Photo credits</summary>
          <p className="max-w-2xl pb-2 leading-relaxed">
            Photos on{' '}
            <a className="underline" href="https://unsplash.com/?utm_source=kaykays&utm_medium=referral" target="_blank" rel="noopener noreferrer">Unsplash</a>
            {' '}by{' '}
            {CREDITED_PHOTOS.map((photo, index) => (
              <span key={photo.id}>
                {index > 0 && ', '}
                <a className="underline" href={`https://unsplash.com/@${photo.username}?utm_source=kaykays&utm_medium=referral`} target="_blank" rel="noopener noreferrer">{photo.by}</a>
              </span>
            ))}.
          </p>
        </details>
      </div>
    </footer>
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
      <UtilityBar />
      <Header section={section} path={path} />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
      <TabBar section={section} />
      <MenuDrawer />
      <CartDrawer />
      <CartToast />
      <StorageNotice />
    </div>
  );
}

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import { CREDITED_PHOTOS } from './images';
import { navigate } from './router';
import { useAuth, useCart, useStorefront } from './store';

const NAV_LINKS = [
  { href: '/shop', label: 'Shop', match: 'shop' },
  { href: '/articles', label: 'Milk Guides', match: 'articles' },
  { href: '/feedback', label: 'Feedback', match: 'feedback' },
  { href: '/contact', label: 'Contact Us', match: 'contact' },
];

const iconLink = 'relative grid size-11 place-items-center text-ink transition hover:text-brand-deep';

function CartLink() {
  const count = useCart((s) => s.lines.length);
  return (
    <a href="/cart" aria-label={count ? `Cart, ${count} items` : 'Cart'} className={iconLink}>
      <ShoppingBag size={21} strokeWidth={1.6} aria-hidden />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-brand-deep text-xs font-bold text-white">
          {count}
        </span>
      )}
    </a>
  );
}

function SearchBox({ onSearch, autoFocus }: { onSearch?: () => void; autoFocus?: boolean }) {
  const [term, setTerm] = useState('');
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/shop?q=${encodeURIComponent(term.trim())}`);
    onSearch?.();
  };
  return (
    <form role="search" onSubmit={handleSubmit} className="relative">
      <label>
        <span className="sr-only">Search products</span>
        <input
          type="search"
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search milk, yoghurt, butter…"
          className="min-h-11 w-full border border-line bg-white py-2 pl-3.5 pr-11 text-base"
        />
      </label>
      <button type="submit" aria-label="Search" className="absolute right-0 top-0 grid size-11 place-items-center text-muted hover:text-ink">
        <Search size={18} strokeWidth={1.6} aria-hidden />
      </button>
    </form>
  );
}

function AnnouncementBar() {
  const { settings } = useStorefront();
  return (
    <p className="bg-ink px-4 py-2 text-center text-[0.8125rem] tracking-wide text-cream">
      Order online and pay with M-Pesa{settings.deliveryEnabled ? ' · Delivery or pickup' : ' · Pickup in store'}
    </p>
  );
}

function Header({ section }: { section: string }) {
  const { name, logoUrl } = useStorefront().business;
  const signedIn = useAuth((s) => Boolean(s.session));
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [section]);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="site-gutter flex h-[4.5rem] items-center gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex min-w-0 items-center gap-1">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="-ml-2.5 grid size-11 shrink-0 place-items-center lg:hidden"
          >
            {menuOpen ? <X strokeWidth={1.6} aria-hidden /> : <Menu strokeWidth={1.6} aria-hidden />}
          </button>
          <a href="/" className="flex min-w-0 items-center gap-2.5">
            <img src={logoUrl || '/logo.png'} alt="" width="34" height="34" className="size-[2.125rem] shrink-0 rounded-full object-cover" />
            <span className="truncate font-display text-[1.625rem] leading-none">{name}</span>
          </a>
        </div>
        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={section === link.match ? 'page' : undefined}
              className={`py-2 text-[0.9375rem] font-medium transition hover:text-brand-deep ${
                section === link.match ? 'text-brand-deep underline underline-offset-8' : 'text-ink'
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center">
          <button onClick={() => setSearchOpen(!searchOpen)} aria-label="Search products" aria-expanded={searchOpen} className={`${iconLink} hidden lg:grid`}>
            <Search size={21} strokeWidth={1.6} aria-hidden />
          </button>
          <a href="/account" aria-label={signedIn ? 'My account' : 'Sign in'} className={iconLink}>
            <User size={21} strokeWidth={1.6} aria-hidden />
          </a>
          <CartLink />
        </div>
      </div>
      {searchOpen && (
        <div className="hidden border-t border-line py-3 lg:block">
          <div className="site-gutter max-w-2xl">
            <SearchBox autoFocus onSearch={() => setSearchOpen(false)} />
          </div>
        </div>
      )}
      {menuOpen && (
        <div className="border-t border-line bg-white pb-4 pt-3 lg:hidden">
          <div className="site-gutter">
            <SearchBox onSearch={() => setMenuOpen(false)} />
            <nav aria-label="Menu" className="mt-2">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="block border-b border-line py-3.5 font-medium last:border-0">
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const { business, products, settings } = useStorefront();
  const categories = Array.from(new Set(products.map((p) => p.category))).slice(0, 5);
  const heading = 'eyebrow !text-[#e9b98f]';
  const link = 'block py-1.5 text-cream/85 transition hover:text-white';

  return (
    <footer className="ember-panel">
      <div className="site-gutter pb-8 pt-14 sm:pt-20">
        <div className="flex flex-col gap-6 border-b border-white/15 pb-12 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="display-lg max-w-2xl">Fresh milk, one simple order away.</h2>
          <a href="/shop" className="btn self-start bg-cream text-ink hover:bg-white lg:self-auto">Shop now</a>
        </div>
        <div className="grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <p className="font-display text-3xl">{business.name}</p>
            {business.description && <p className="mt-3 max-w-xs leading-relaxed text-cream/80">{business.description}</p>}
          </div>
          <nav aria-label="Shop links">
            <h3 className={heading}>Shop</h3>
            <div className="mt-3">
              <a href="/shop" className={link}>All products</a>
              {categories.map((category) => (
                <a key={category} href={`/shop?category=${encodeURIComponent(category)}`} className={link}>{category}</a>
              ))}
            </div>
          </nav>
          <nav aria-label="Help links">
            <h3 className={heading}>Help</h3>
            <div className="mt-3">
              <a href="/account/orders" className={link}>My orders</a>
              <a href="/account/schedules" className={link}>Regular orders</a>
              <a href="/articles" className={link}>Milk guides</a>
              <a href="/feedback" className={link}>Give feedback</a>
            </div>
          </nav>
          <div>
            <h3 className={heading}>Visit or call</h3>
            <div className="mt-3 space-y-1.5">
              {business.address && <p className="py-1.5 text-cream/85">{business.address}</p>}
              {business.contactPhone && <a href={`tel:${business.contactPhone}`} className={link}>{business.contactPhone}</a>}
              {business.contactEmail && <a href={`mailto:${business.contactEmail}`} className={`${link} break-all`}>{business.contactEmail}</a>}
              <a href="/contact" className={link}>Find us</a>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/15 pt-6 text-sm text-cream/70 lg:flex-row lg:items-center lg:justify-between">
          <p>© {new Date().getFullYear()} {business.name}. Pay with M-Pesa{settings.deliveryEnabled ? ' · Delivery or pickup' : ''}.</p>
          <details>
            <summary className="cursor-pointer py-2">Photo credits</summary>
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
      </div>
    </footer>
  );
}

export default function Layout({ section, children }: { section: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AnnouncementBar />
      <Header section={section} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

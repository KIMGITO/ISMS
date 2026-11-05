import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Menu, Search, ShoppingCart, User, X } from 'lucide-react';
import { navigate } from './router';
import { useAuth, useCart, useStorefront } from './store';

const NAV_LINKS = [
  { href: '/shop', label: 'Shop', match: 'shop' },
  { href: '/articles', label: 'Milk guides', match: 'articles' },
  { href: '/contact', label: 'Contact', match: 'contact' },
];

function CartLink() {
  const count = useCart((s) => s.lines.length);
  return (
    <a href="/cart" aria-label={count ? `Cart, ${count} items` : 'Cart'} className="relative grid size-11 place-items-center text-ink hover:text-brand-deep">
      <ShoppingCart size={23} aria-hidden />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-brand-deep text-xs font-bold text-white">
          {count}
        </span>
      )}
    </a>
  );
}

function SearchBox({ className, onSearch }: { className: string; onSearch?: () => void }) {
  const [term, setTerm] = useState('');
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/shop?q=${encodeURIComponent(term.trim())}`);
    onSearch?.();
  };
  return (
    <form role="search" onSubmit={handleSubmit} className={`relative ${className}`}>
      <label>
        <span className="sr-only">Search products</span>
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search products"
          className="min-h-11 w-full rounded-lg border border-line bg-white py-2 pl-3.5 pr-11 text-base"
        />
      </label>
      <button type="submit" aria-label="Search" className="absolute right-0 top-0 grid size-11 place-items-center text-muted hover:text-ink">
        <Search size={19} aria-hidden />
      </button>
    </form>
  );
}

function Header({ section }: { section: string }) {
  const { name, logoUrl } = useStorefront().business;
  const signedIn = useAuth((s) => Boolean(s.session));
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [section]);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:gap-8">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="-ml-2 grid size-11 shrink-0 place-items-center lg:hidden"
        >
          {menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
        <a href="/" className="flex min-w-0 items-center gap-2.5 font-display text-xl font-bold">
          <img src={logoUrl || '/logo.png'} alt="" width="36" height="36" className="size-9 shrink-0 rounded-full object-cover" />
          <span className="truncate">{name}</span>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={section === link.match ? 'page' : undefined}
              className={`font-medium hover:text-brand-deep ${section === link.match ? 'text-brand-deep' : 'text-ink'}`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <SearchBox className="ml-auto hidden w-full max-w-sm md:block" />
        <div className="ml-auto flex shrink-0 items-center md:ml-0">
          <a href="/account" className="flex min-h-11 items-center gap-1.5 px-2 font-medium text-ink hover:text-brand-deep" aria-label={signedIn ? 'My account' : 'Sign in'}>
            <User size={23} aria-hidden />
            <span className="hidden xl:inline">{signedIn ? 'My account' : 'Sign in'}</span>
          </a>
          <CartLink />
        </div>
      </div>
      {menuOpen && (
        <div className="border-t border-line bg-white px-4 pb-4 pt-3 lg:hidden">
          <SearchBox className="md:hidden" onSearch={() => setMenuOpen(false)} />
          <nav aria-label="Menu" className="mt-2">
            {[...NAV_LINKS, { href: '/feedback', label: 'Feedback', match: 'feedback' }].map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="block py-3 font-medium">
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const { business, products } = useStorefront();
  const categories = Array.from(new Set(products.map((p) => p.category))).slice(0, 5);
  const heading = 'font-display text-base font-semibold text-white';
  const link = 'block py-1.5 text-stone-300 hover:text-white';

  return (
    <footer className="bg-hero text-stone-300">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="font-display text-xl font-bold text-white">{business.name}</p>
          {business.description && <p className="mt-2 max-w-xs">{business.description}</p>}
        </div>
        <nav aria-label="Shop links">
          <h2 className={heading}>Shop</h2>
          <div className="mt-2">
            <a href="/shop" className={link}>All products</a>
            {categories.map((category) => (
              <a key={category} href={`/shop?category=${encodeURIComponent(category)}`} className={link}>{category}</a>
            ))}
          </div>
        </nav>
        <nav aria-label="Help links">
          <h2 className={heading}>Help</h2>
          <div className="mt-2">
            <a href="/account/orders" className={link}>My orders</a>
            <a href="/articles" className={link}>Milk guides</a>
            <a href="/feedback" className={link}>Give feedback</a>
            <a href="/contact" className={link}>Contact us</a>
          </div>
        </nav>
        <div>
          <h2 className={heading}>Contact</h2>
          <div className="mt-2 space-y-1.5">
            {business.address && <p>{business.address}</p>}
            {business.contactPhone && <a href={`tel:${business.contactPhone}`} className={link}>{business.contactPhone}</a>}
            {business.contactEmail && <a href={`mailto:${business.contactEmail}`} className={`${link} break-all`}>{business.contactEmail}</a>}
          </div>
        </div>
      </div>
      <div className="border-t border-white/15 px-4 py-5 text-center text-sm">
        © {new Date().getFullYear()} {business.name}. All rights reserved.
      </div>
    </footer>
  );
}

export default function Layout({ section, children }: { section: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header section={section} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

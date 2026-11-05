// src/features/QuickSaleView.tsx
// The fastest path to record a sale: tap or scan, then one tap on how the customer paid.
// Discounts, delivery and credit sales stay in the full POS screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Minus, Plus, Search, Smartphone, X } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { PaymentMethod, Product } from '../types';
import { formatCurrency } from '../utils/helpers';
import { searchMatch } from '../utils/stringUtils';
import { toUserMessage } from '../utils/userError';

const PAY_OPTIONS: Array<{ method: PaymentMethod; label: string; key: string; icon: typeof Banknote; style: string }> = [
  { method: 'Cash', label: 'Cash', key: 'F1', icon: Banknote, style: 'bg-emerald-600 hover:bg-emerald-700' },
  { method: 'M-Pesa', label: 'M-Pesa', key: 'F2', icon: Smartphone, style: 'bg-green-700 hover:bg-green-800' },
  { method: 'Card', label: 'Card', key: 'F3', icon: CreditCard, style: 'bg-blue-600 hover:bg-blue-700' },
];

// Only desktop gets auto-focus: on a phone it would pop the keyboard over the product grid.
const hasPhysicalKeyboard = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export default function QuickSaleView() {
  const {
    products, cart, transactions, addToCart, updateCartQty, removeFromCart,
    clearCart, checkout, showToast, businesses, activeBusinessId,
  } = useAppStore();

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<{ total: number; method: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeBusiness = businesses.find((b) => b.id === activeBusinessId);
  const taxRate = activeBusiness?.isTaxEnabled
    ? (typeof activeBusiness.taxPercentage === 'number' ? activeBusiness.taxPercentage / 100 : 0.16)
    : 0;

  // The products this shop actually sells come first, so most sales need no searching.
  const salesRank = useMemo(() => {
    const rank = new Map<string, number>();
    transactions.slice(-300).forEach((tx: any) => {
      (tx.items || []).forEach((item: any) => {
        const id = item.productId || item.product?.id;
        if (id) rank.set(id, (rank.get(id) || 0) + (item.quantity || 1));
      });
    });
    return rank;
  }, [transactions]);

  const visibleProducts = useMemo(() => {
    const matches = products.filter((p) => !query || searchMatch(p.name, query) || searchMatch(p.sku, query));
    return [...matches].sort(
      (a, b) =>
        Number(b.stock > 0) - Number(a.stock > 0) ||
        (salesRank.get(b.id) || 0) - (salesRank.get(a.id) || 0) ||
        a.name.localeCompare(b.name),
    );
  }, [products, query, salesRank]);

  const subtotal = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity * (1 - item.discountPercentage / 100),
    0,
  );
  const total = subtotal * (1 + taxRate);

  const focusSearch = () => {
    if (hasPhysicalKeyboard()) searchRef.current?.focus();
  };

  useEffect(focusSearch, []);
  useEffect(() => setHighlight(0), [query]);

  const addProduct = (product: Product) => {
    setLastSale(null);
    setError(null);
    const inCart = cart.find((item) => item.product.id === product.id)?.quantity || 0;
    if (inCart >= product.stock) {
      showToast('Out of Stock', `Only ${product.stock} ${product.name} available.`, undefined, 'info');
      return;
    }
    addToCart(product);
    setQuery('');
    focusSearch();
  };

  const pay = async (method: PaymentMethod) => {
    if (cart.length === 0 || isPaying) return;
    setIsPaying(true);
    setError(null);
    const saleTotal = total;
    try {
      const result = await checkout(method, '', taxRate);
      if (result.success) {
        setLastSale({ total: saleTotal, method });
      } else {
        setError(toUserMessage(result.error, 'The sale could not be saved. Please try again.'));
      }
    } catch (err) {
      setError(toUserMessage(err, 'The sale could not be saved. Please try again.'));
    } finally {
      setIsPaying(false);
      focusSearch();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const payOption = PAY_OPTIONS.find((option) => option.key === e.key);
    if (payOption) {
      e.preventDefault();
      pay(payOption.method);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else clearCart();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => Math.max(0, Math.min(visibleProducts.length - 1, h + step)));
    } else if (e.key === 'Enter' && query) {
      // Barcode scanners type the SKU and press Enter, so an exact match always wins.
      e.preventDefault();
      const exact = products.find((p) => p.sku && p.sku.toLowerCase() === query.trim().toLowerCase());
      const target = exact || visibleProducts[highlight];
      if (target) addProduct(target);
    } else if ((e.key === '+' || e.key === '-') && cart.length > 0) {
      e.preventDefault();
      const last = cart[cart.length - 1];
      const next = last.quantity + (e.key === '+' ? 1 : -1);
      if (next <= 0) removeFromCart(last.product.id);
      else updateCartQty(last.product.id, next);
    }
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-app-bg" onKeyDown={handleKeyDown}>
      {/* Products */}
      <section className="flex-1 min-h-0 flex flex-col" aria-label="Products">
        <div className="p-3 border-b border-app-border bg-app-card">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or scan a product"
              aria-label="Search or scan a product"
              autoComplete="off"
              enterKeyHint="done"
              className="w-full bg-app-bg text-app-text text-base pl-10 pr-3 py-3 rounded-xl border border-app-border focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 content-start">
          {visibleProducts.map((product, index) => {
            const soldOut = product.stock <= 0;
            const inCart = cart.find((item) => item.product.id === product.id)?.quantity || 0;
            return (
              <button
                key={product.id}
                type="button"
                disabled={soldOut}
                onClick={() => addProduct(product)}
                className={`relative min-h-[84px] p-3 text-left rounded-xl border bg-app-card transition cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
                  query && index === highlight ? 'border-amber-500 ring-2 ring-amber-500' : 'border-app-border hover:border-amber-500'
                }`}
              >
                <span className="block text-sm font-semibold text-app-text leading-snug line-clamp-2">{product.name}</span>
                <span className="block mt-1 text-sm font-bold text-amber-600">{formatCurrency(product.price)}</span>
                <span className="block text-xs text-app-text-muted">{soldOut ? 'Sold out' : `${product.stock} left`}</span>
                {inCart > 0 && (
                  <span className="absolute top-2 right-2 min-w-6 h-6 px-1.5 flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold">
                    {inCart}
                  </span>
                )}
              </button>
            );
          })}
          {visibleProducts.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-app-text-muted">No products match "{query}".</p>
          )}
        </div>
      </section>

      {/* Current sale */}
      <section
        className="shrink-0 md:w-80 lg:w-96 max-h-[55%] md:max-h-none flex flex-col border-t md:border-t-0 md:border-l border-app-border bg-app-card"
        aria-label="Current sale"
      >
        {lastSale && cart.length === 0 && (
          <div role="status" className="m-3 p-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={20} aria-hidden="true" />
            Sold {formatCurrency(lastSale.total)} by {lastSale.method}
          </div>
        )}

        {cart.length === 0 && !lastSale && (
          <p className="hidden md:block p-6 text-center text-sm text-app-text-muted">
            Tap a product to start a sale.
          </p>
        )}

        <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-app-border">
          {cart.map((item) => (
            <li key={item.product.id} className="flex items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-app-text truncate">{item.product.name}</p>
                <p className="text-xs text-app-text-muted">{formatCurrency(item.product.price * item.quantity)}</p>
              </div>
              <button
                type="button"
                aria-label={`One less ${item.product.name}`}
                onClick={() =>
                  item.quantity <= 1 ? removeFromCart(item.product.id) : updateCartQty(item.product.id, item.quantity - 1)
                }
                className="w-10 h-10 flex items-center justify-center rounded-lg border border-app-border text-app-text cursor-pointer"
              >
                {item.quantity <= 1 ? <X size={16} /> : <Minus size={16} />}
              </button>
              <span className="w-7 text-center text-sm font-bold text-app-text" aria-label={`Quantity ${item.quantity}`}>
                {item.quantity}
              </span>
              <button
                type="button"
                aria-label={`One more ${item.product.name}`}
                onClick={() => addProduct(item.product)}
                className="w-10 h-10 flex items-center justify-center rounded-lg border border-app-border text-app-text cursor-pointer"
              >
                <Plus size={16} />
              </button>
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mx-3 mb-2 p-2 rounded-lg bg-red-500/10 text-red-600 text-sm">{error}</p>
        )}

        {cart.length > 0 && (
          <div className="p-3 border-t border-app-border space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-app-text-muted">Total{taxRate > 0 ? ' incl. tax' : ''}</span>
              <span className="text-2xl font-black text-app-text">{formatCurrency(total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {PAY_OPTIONS.map(({ method, label, key, icon: Icon, style }) => (
                <button
                  key={method}
                  type="button"
                  disabled={isPaying}
                  onClick={() => pay(method)}
                  className={`min-h-[64px] rounded-xl text-white font-bold text-sm flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-60 ${style}`}
                >
                  <Icon size={20} aria-hidden="true" />
                  {label}
                  <span className="hidden lg:block text-[10px] font-normal opacity-80">{key}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={clearCart}
              className="w-full py-2 text-sm text-app-text-muted hover:text-red-500 cursor-pointer"
            >
              Clear sale
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

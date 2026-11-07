// src/features/QuickSaleView.tsx
// The fastest path to record a sale: tap or scan, then one tap on how the customer paid.
// Discounts, delivery and credit sales stay in the full POS screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Banknote, CheckCircle2, CreditCard, Minus, Plus, ReceiptText, Search, Smartphone, X } from 'lucide-react';
import { nativeUiService } from '../core/native/NativeUiService';
import { useAppStore } from '../stores/appStore';
import { PaymentMethod, Product, Transaction } from '../types';
import { ReceiptSheet } from '../components/receipts/ReceiptSheet';
import { ReceiptService } from '../services/receipt/ReceiptService';
import { formatCurrency } from '../utils/helpers';
import { searchMatch } from '../utils/stringUtils';
import { toUserMessage } from '../utils/userError';

const PAY_OPTIONS: Array<{ method: PaymentMethod; label: string; key: string; icon: typeof Banknote; style: string }> = [
  { method: 'Cash', label: 'Cash', key: 'F1', icon: Banknote, style: 'bg-emerald-600 hover:bg-emerald-700' },
  { method: 'M-Pesa', label: 'M-Pesa', key: 'F2', icon: Smartphone, style: 'bg-green-700 hover:bg-green-800' },
  { method: 'Card', label: 'Card', key: 'F3', icon: CreditCard, style: 'bg-blue-600 hover:bg-blue-700' },
];

// Sale quantities are stored with up to 3 decimals (e.g. 0.25 kg).
const roundQty = (n: number) => Math.round(n * 1000) / 1000;
const formatQty = (n: number) => String(roundQty(n));

/**
 * Quantity box: type any amount (decimals allowed, "," or "."), or use − / +.
 * The typed value applies on Enter or when leaving the box; 0 removes the item.
 */
function QtyInput({ value, unit, label, onCommit }: {
  value: number;
  unit?: string;
  label: string;
  onCommit: (qty: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseFloat(draft.replace(',', '.'));
    setDraft(null);
    if (!Number.isNaN(parsed) && roundQty(parsed) !== value) onCommit(roundQty(parsed));
  };
  return (
    <label className="relative flex flex-col items-center">
      <span className="sr-only">{label}</span>
      <motion.input
        key={value}
        initial={{ scale: 1.18 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        value={draft ?? formatQty(value)}
        onFocus={(e) => { setDraft(formatQty(value)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => {
          const next = e.target.value;
          if (/^\d*([.,]\d{0,3})?$/.test(next)) setDraft(next);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep the screen's + / − / Enter shortcuts out of the box
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
        className="w-14 h-10 rounded-md bg-app-bg text-center text-sm font-bold text-app-text tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      {unit && <span className="text-[10px] leading-none mt-0.5 text-app-text-muted">{unit}</span>}
    </label>
  );
}

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
  const [lastSale, setLastSale] = useState<{ total: number; method: string; tx?: Transaction } | null>(null);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [receiptAutoPrint, setReceiptAutoPrint] = useState(false);
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
      showToast('Out of Stock', `Only ${formatQty(product.stock)} ${product.name} available.`, undefined, 'info');
      nativeUiService.hapticError();
      return;
    }
    if (inCart > 0) {
      setQty(product, inCart + 1);
    } else {
      nativeUiService.hapticTap();
      addToCart(product);
    }
    setQuery('');
    focusSearch();
  };

  /** Sets a cart line to an exact quantity: 0 removes it, more than stock is capped with a notice. */
  const setQty = (product: Product, qty: number) => {
    setLastSale(null);
    nativeUiService.hapticTap();
    if (qty <= 0) {
      removeFromCart(product.id);
      return;
    }
    if (qty > product.stock) {
      showToast('Not enough stock', `Only ${formatQty(product.stock)} ${product.name} available.`, undefined, 'info');
      nativeUiService.hapticError();
      qty = product.stock;
    }
    updateCartQty(product.id, roundQty(qty));
  };

  const pay = async (method: PaymentMethod) => {
    if (cart.length === 0 || isPaying) return;
    setIsPaying(true);
    setError(null);
    const saleTotal = total;
    try {
      const result = await checkout(method, '', taxRate);
      if (result.success) {
        setLastSale({ total: saleTotal, method, tx: result.transaction });
        if (result.transaction && activeBusinessId && ReceiptService.getSettings(activeBusinessId).autoPrint) {
          setReceiptAutoPrint(true);
          setReceiptTx(result.transaction);
        }
        nativeUiService.hapticSuccess();
      } else {
        setError(toUserMessage(result.error, 'The sale could not be saved. Please try again.'));
        nativeUiService.hapticError();
      }
    } catch (err) {
      setError(toUserMessage(err, 'The sale could not be saved. Please try again.'));
      nativeUiService.hapticError();
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
    } else if (e.key === 'F8') {
      e.preventDefault();
      if (lastSale?.tx) {
        setReceiptAutoPrint(false);
        setReceiptTx(lastSale.tx);
      }
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
      setQty(last.product, last.quantity + (e.key === '+' ? 1 : -1));
    }
  };

  return (
    <>
    // On phones the sale panel ends above the floating nav bar instead of behind it.
    <div
      className="h-full flex flex-col md:flex-row bg-app-bg max-md:pb-[calc(var(--mobile-nav-height)+var(--mobile-nav-gap)*2+var(--inset-bottom))]"
      onKeyDown={handleKeyDown}
    >
      {/* Products */}
      <section className="flex-1 min-h-0 flex flex-col" aria-label="Products">
        <div className="py-2 md:p-3 bg-app-card">
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
              className="w-full bg-app-bg text-app-text text-base pl-10 pr-3 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1 md:p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 md:gap-2 content-start">
          {visibleProducts.map((product, index) => {
            const soldOut = product.stock <= 0;
            const inCart = cart.find((item) => item.product.id === product.id)?.quantity || 0;
            return (
              <button
                key={product.id}
                type="button"
                disabled={soldOut}
                onClick={() => addProduct(product)}
                className={`relative min-h-[84px] p-3 text-left rounded-lg bg-app-card transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  query && index === highlight ? 'ring-2 ring-amber-500' : inCart > 0 ? 'ring-1 ring-amber-500/60' : 'hover:ring-1 hover:ring-amber-500/50'
                }`}
              >
                <span className="block text-sm font-semibold text-app-text leading-snug line-clamp-2">{product.name}</span>
                <span className="block mt-1 text-sm font-bold text-amber-600">{formatCurrency(product.price)}</span>
                <span className="block text-xs text-app-text-muted">{soldOut ? 'Sold out' : `${formatQty(product.stock)} ${product.unit || ''} left`}</span>
                {inCart > 0 && (
                  <motion.span
                    key={inCart}
                    initial={{ scale: 1.4 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                    className="absolute top-2 right-2 min-w-6 h-6 px-1.5 flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold tabular-nums"
                  >
                    {formatQty(inCart)}
                  </motion.span>
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
        className="shrink-0 md:w-80 lg:w-96 max-h-[55%] md:max-h-none flex flex-col md:border-l border-app-border bg-app-card shadow-[0_-6px_16px_-12px_rgba(0,0,0,0.35)] md:shadow-none"
        aria-label="Current sale"
      >
        {lastSale && cart.length === 0 && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className="m-2 md:m-3 p-3 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={20} aria-hidden="true" />
            <span className="flex-1">Sold {formatCurrency(lastSale.total)} by {lastSale.method}</span>
            {lastSale.tx && (
              <button
                type="button"
                onClick={() => {
                  setReceiptAutoPrint(false);
                  setReceiptTx(lastSale.tx!);
                }}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
              >
                <ReceiptText size={14} aria-hidden="true" /> Receipt
                <kbd className="hidden md:inline px-1 rounded border border-white/40 text-[10px] font-mono">F8</kbd>
              </button>
            )}
          </motion.div>
        )}

        {cart.length === 0 && !lastSale && (
          <p className="hidden md:block p-6 text-center text-sm text-app-text-muted">
            Tap a product to start a sale.
          </p>
        )}

        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-app-border/60">
          {cart.map((item) => (
            <motion.li
              key={item.product.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-app-text truncate">{item.product.name}</p>
                <p className="text-xs text-app-text-muted">{formatCurrency(item.product.price * item.quantity)}</p>
              </div>
              <button
                type="button"
                aria-label={`One less ${item.product.name}`}
                onClick={() => setQty(item.product, item.quantity <= 1 ? 0 : item.quantity - 1)}
                className="w-10 h-10 flex items-center justify-center rounded-md bg-app-bg text-app-text cursor-pointer"
              >
                {item.quantity <= 1 ? <X size={16} /> : <Minus size={16} />}
              </button>
              <QtyInput
                value={item.quantity}
                unit={item.product.unit}
                label={`Quantity of ${item.product.name}`}
                onCommit={(qty) => setQty(item.product, qty)}
              />
              <button
                type="button"
                aria-label={`One more ${item.product.name}`}
                onClick={() => setQty(item.product, item.quantity + 1)}
                className="w-10 h-10 flex items-center justify-center rounded-md bg-app-bg text-app-text cursor-pointer"
              >
                <Plus size={16} />
              </button>
            </motion.li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mx-3 mb-2 p-2 rounded-lg bg-red-500/10 text-red-600 text-sm">{error}</p>
        )}

        {cart.length > 0 && (
          <div className="p-2 md:p-3 border-t border-app-border/60 space-y-2">
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
                  className={`min-h-[64px] rounded-lg text-white font-bold text-sm flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-60 ${style}`}
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
    <ReceiptSheet
      transaction={receiptTx}
      startPrinting={receiptAutoPrint}
      onClose={() => {
        setReceiptTx(null);
        setReceiptAutoPrint(false);
        focusSearch();
      }}
    />
    </>
  );
}

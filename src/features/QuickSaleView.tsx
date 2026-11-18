// src/features/QuickSaleView.tsx
// The fastest path to record a sale: tap or scan, then one tap on how the customer paid.
// Discounts, delivery and credit sales stay in the full POS screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Banknote, CheckCircle2, CloudOff, CreditCard, Minus, Plus, ReceiptText, Search, Smartphone, X } from 'lucide-react';
import { nativeUiService } from '../core/native/NativeUiService';
import { useAppStore } from '../stores/appStore';
import { MoneyMethod, PaymentMethod, Product, Transaction } from '../types';
import { usePaymentMethods } from '../hooks/usePaymentMethods';
import { ReceiptSheet } from '../components/receipts/ReceiptSheet';
import { SaleCustomerPicker } from '../components/SaleCustomerPicker';
import { ReceiptService } from '../services/receipt/ReceiptService';
import { formatCurrency } from '../utils/helpers';
import { QTY_DECIMALS, roundQty, formatQty } from '../utils/money';
import { displayName, searchMatch } from '../utils/stringUtils';
import { toUserMessage } from '../utils/userError';
import { useVatPercent } from '../services/kra/kraService';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { NumberInput } from '../components/shared/Input';

const PAY_OPTIONS: Array<{ method: PaymentMethod; label: string; key: string; icon: typeof Banknote; style: string }> = [
  // Same numbers as POS: Alt+1 Cash, Alt+2 M-Pesa, Alt+4 Card, Alt+6 Airtel Money.
  { method: 'Cash', label: 'Cash', key: 'Alt+1', icon: Banknote, style: 'bg-emerald-600 hover:bg-emerald-700' },
  { method: 'M-Pesa', label: 'M-Pesa', key: 'Alt+2', icon: Smartphone, style: 'bg-green-700 hover:bg-green-800' },
  { method: 'Card', label: 'Card', key: 'Alt+4', icon: CreditCard, style: 'bg-blue-600 hover:bg-blue-700' },
  { method: 'Airtel Money', label: 'Airtel', key: 'Alt+6', icon: Smartphone, style: 'bg-red-600 hover:bg-red-700' },
];

// Sale quantities have at most one decimal place (e.g. 1.5 kg). Plain digits while typing.
const qtyText = (n: number) => String(roundQty(n));

/**
 * Quantity box: type any amount (decimals allowed, "," or "."), or use − / +.
 * The screen holds what is being typed (so the phone panel can show it); it applies
 * on Enter or when leaving the box; 0 removes the item.
 */
function QtyInput({ value, unit, label, draft, onStart, onDraft, onCommit, onCancel }: {
  value: number;
  unit?: string;
  label: string;
  draft: string | null;
  onStart: (input: HTMLInputElement) => void;
  onDraft: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center">
      <motion.div
        key={value}
        initial={{ scale: 1.18 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      >
        <NumberInput
          aria-label={label}
          value={draft ?? value}
          onChange={(n) => onDraft(n == null ? '' : qtyText(n))}
          min={0}
          decimals={QTY_DECIMALS}
          grouping={false}
          onFocus={(e) => onStart(e.target)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            e.stopPropagation(); // keep the screen's + / − / Enter shortcuts out of the box
            if (e.key === 'Escape') onCancel();
          }}
          className="w-14 !h-10 !px-1"
          inputClassName="text-center font-bold tabular-nums"
        />
      </motion.div>
      {unit && <span className="text-[10px] leading-none mt-0.5 text-app-text-muted">{unit}</span>}
    </div>
  );
}

/** The part of the screen the phone keyboard leaves visible, kept up to date while it moves. */
function useVisibleArea(active: boolean) {
  const read = () => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    return { top: vv?.offsetTop ?? 0, height: vv?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0) };
  };
  const [area, setArea] = useState(read);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const update = () => setArea(read());
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [active]);
  return area;
}

const parseQty = (draft: string) => {
  const n = parseFloat(draft.replace(',', '.'));
  return Number.isNaN(n) ? null : roundQty(n);
};

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
  const [lastSale, setLastSale] = useState<{ total: number; method: string; tx?: Transaction; offline?: boolean } | null>(null);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [receiptAutoPrint, setReceiptAutoPrint] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // The quantity being typed. A ref too, so a blur straight after Cancel sees the cancel.
  const [editing, setEditingState] = useState<{ id: string; draft: string } | null>(null);
  const editingRef = useRef<{ id: string; draft: string } | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const setEditing = (next: { id: string; draft: string } | null) => {
    editingRef.current = next;
    setEditingState(next);
  };
  // On a phone, typing a quantity brings a panel above the keyboard (the cart sits under it).
  const keyboardOpen = useKeyboardVisible();
  const showQtyPanel = !!editing && keyboardOpen;
  const visibleArea = useVisibleArea(showQtyPanel);
  // Only the methods this business has switched on.
  const enabled = usePaymentMethods();
  const payOptions = PAY_OPTIONS.filter((o) => enabled.includes(o.method as MoneyMethod));

  const activeBusiness = businesses.find((b) => b.id === activeBusinessId);
  // No VAT at all unless KRA eTIMS is connected, whatever the tax switch says.
  const taxRate = useVatPercent(activeBusiness) / 100;

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
      showToast('Out of Stock', `Only ${formatQty(product.stock)} ${displayName(product.name)} available.`, undefined, 'info');
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
      showToast('Not enough stock', `Only ${formatQty(product.stock)} ${displayName(product.name)} available.`, undefined, 'info');
      nativeUiService.hapticError();
      qty = product.stock;
    }
    updateCartQty(product.id, roundQty(qty));
  };

  const commitEdit = () => {
    const current = editingRef.current;
    if (!current) return;
    setEditing(null);
    const item = cart.find((i) => i.product.id === current.id);
    const qty = parseQty(current.draft);
    if (item && qty !== null && qty !== item.quantity) setQty(item.product, qty);
  };

  const cancelEdit = () => {
    setEditing(null);
    editInputRef.current?.blur();
  };

  /** − / + in the phone panel change the typed number, keeping the keyboard open. */
  const stepDraft = (step: number) => {
    const current = editingRef.current;
    if (!current) return;
    const next = Math.max(0, roundQty((parseQty(current.draft) ?? 0) + step));
    setEditing({ ...current, draft: qtyText(next) });
  };

  const pay = async (method: PaymentMethod) => {
    if (cart.length === 0 || isPaying) return;
    setIsPaying(true);
    setError(null);
    const saleTotal = total;
    try {
      const result = await checkout(method, '', taxRate);
      if (result.success) {
        setLastSale({ total: saleTotal, method, tx: result.transaction, offline: result.offline });
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
    // e.code, so Alt+number works whatever the keyboard layout types for it.
    const altKey = e.altKey && !e.ctrlKey && !e.metaKey ? (e.code.startsWith('Digit') ? `Alt+${e.code.slice(5)}` : e.code === 'KeyC' ? 'Alt+C' : e.code === 'KeyR' ? 'Alt+R' : '') : '';
    const payOption = altKey ? payOptions.find((option) => option.key === altKey) : undefined;
    if (payOption) {
      e.preventDefault();
      pay(payOption.method);
    } else if (altKey === 'Alt+C') {
      e.preventDefault();
      (document.querySelector('[aria-label="Current sale"] [data-shortcut="add-customer"]') as HTMLElement | null)?.click();
    } else if (altKey === 'Alt+R') {
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
    <div
      className="nav-room h-full flex flex-col md:flex-row short-landscape:flex-row bg-app-bg max-md:pb-[calc(var(--mobile-nav-height)+var(--mobile-nav-gap)*2+var(--inset-bottom))]"
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
                <span className="block text-sm font-semibold text-app-text leading-snug line-clamp-2">{displayName(product.name)}</span>
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
        className="shrink-0 md:w-80 lg:w-96 max-h-[55%] md:max-h-none short-landscape:w-72 short-landscape:max-h-none short-landscape:border-l short-landscape:shadow-none flex flex-col md:border-l border-app-border bg-app-card shadow-[0_-6px_16px_-12px_rgba(0,0,0,0.35)] md:shadow-none"
        aria-label="Current sale"
      >
        {lastSale && cart.length === 0 && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className={`m-2 md:m-3 p-3 rounded-lg flex items-center gap-2 text-sm font-semibold ${
              lastSale.offline
                ? 'bg-rose-600/12 text-rose-700 dark:text-rose-300' // saved on this phone, syncs later
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            }`}>
            {lastSale.offline ? <CloudOff size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}
            <span className="flex-1">
              {lastSale.offline ? 'Saved offline: ' : 'Sold '}
              {formatCurrency(lastSale.total)} by {lastSale.method}
              {lastSale.offline && <span className="block text-xs font-normal">Syncs when you're back online.</span>}
            </span>
            {lastSale.tx?.customerId && (
              <span className="shrink-0 text-xs font-normal truncate max-w-[8rem]">{lastSale.tx.customerName}</span>
            )}
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
                <kbd className="hidden md:inline px-1 rounded border border-white/40 text-[10px] font-mono">Alt+R</kbd>
              </button>
            )}
          </motion.div>
        )}
        {/* Quick sales skip the customer; this puts the sale on their account afterwards. */}
        {lastSale?.tx && cart.length === 0 && !lastSale.tx.customerId && (
          <SaleCustomerPicker
            transaction={lastSale.tx}
            className="mx-2 md:mx-3 mb-2"
            onAttached={(tx) => setLastSale((s) => (s ? { ...s, tx } : s))}
          />
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
                draft={editing?.id === item.product.id ? editing.draft : null}
                onStart={(input) => {
                  editInputRef.current = input;
                  setEditing({ id: item.product.id, draft: qtyText(item.quantity) });
                }}
                onDraft={(draft) => setEditing({ id: item.product.id, draft })}
                onCommit={commitEdit}
                onCancel={cancelEdit}
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
              <span className="text-2xl font-bold text-app-text">{formatCurrency(total)}</span>
            </div>
            <div className={`grid gap-2 ${payOptions.length >= 4 ? 'grid-cols-2' : payOptions.length === 3 ? 'grid-cols-3' : payOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {payOptions.length === 0 && (
                <p className="text-xs text-app-text-muted py-2 text-center">No payment methods are on. Use POS.</p>
              )}
              {payOptions.map(({ method, label, key, icon: Icon, style }) => (
                <button
                  key={method}
                  type="button"
                  disabled={isPaying}
                  onClick={() => pay(method)}
                  className={`min-h-[64px] short-landscape:min-h-11 short-landscape:flex-row rounded-lg text-white font-bold text-sm flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-60 ${style}`}
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
    {showQtyPanel && editing && (() => {
      const item = cart.find((i) => i.product.id === editing.id);
      if (!item) return null;
      const price = item.product.price * (1 - item.discountPercentage / 100);
      const typed = parseQty(editing.draft) ?? 0;
      const qty = Math.min(typed, item.product.stock);
      const line = price * qty;
      const newTotal = (subtotal - price * item.quantity + line) * (1 + taxRate);
      const unit = item.product.unit || '';
      // Buttons here must not take focus from the box, or the keyboard would close.
      const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
      return (
        <div
          className="md:hidden fixed inset-x-0 z-[70] flex flex-col justify-end bg-black/50"
          style={{ top: visibleArea.top, height: visibleArea.height }}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => editInputRef.current?.blur()}
        >
          <motion.div
            role="dialog"
            aria-label={`Quantity of ${item.product.name}`}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="m-2 p-4 rounded-xl bg-app-card shadow-2xl space-y-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-base font-semibold text-app-text truncate">{displayName(item.product.name)}</p>
              <p className="shrink-0 text-sm text-app-text-muted">{formatCurrency(price)}{unit ? ` / ${unit}` : ' each'}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="One less"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => stepDraft(-1)}
                className="w-14 h-14 shrink-0 flex items-center justify-center rounded-lg bg-app-bg text-app-text cursor-pointer"
              >
                <Minus size={22} />
              </button>
              <div className="flex-1 min-w-0 h-14 flex items-center justify-center gap-1.5 rounded-lg bg-app-bg ring-2 ring-amber-500">
                <span className="text-3xl font-bold text-app-text tabular-nums truncate">{editing.draft || '0'}</span>
                <span className="w-0.5 h-7 bg-amber-500 animate-pulse" aria-hidden="true" />
                {unit && <span className="text-sm text-app-text-muted">{unit}</span>}
              </div>
              <button
                type="button"
                aria-label="One more"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => stepDraft(1)}
                className="w-14 h-14 shrink-0 flex items-center justify-center rounded-lg bg-app-bg text-app-text cursor-pointer"
              >
                <Plus size={22} />
              </button>
            </div>

            <div className="text-sm space-y-1">
              <div className="flex justify-between text-app-text-muted tabular-nums">
                <span>{formatCurrency(price)} × {formatQty(qty)}</span>
                <span className="font-semibold text-app-text">{formatCurrency(line)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-app-text-muted">Sale total{taxRate > 0 ? ' incl. tax' : ''}</span>
                <span className="text-xl font-bold text-app-text tabular-nums">{formatCurrency(newTotal)}</span>
              </div>
              {typed > item.product.stock && (
                <p className="text-amber-600 text-xs">Only {formatQty(item.product.stock)} {unit} left.</p>
              )}
              {typed === 0 && <p className="text-red-600 text-xs">0 removes this item.</p>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={cancelEdit}
                className="h-12 rounded-lg bg-app-bg text-app-text font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => editInputRef.current?.blur()}
                className="h-12 rounded-lg bg-amber-500 text-slate-950 font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </motion.div>
        </div>
      );
    })()}
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

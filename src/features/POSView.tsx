import { toUserMessage } from '../utils/userError';
import { useModule } from '../stores/planStore';
import { DEFAULT_POINT_SETTINGS, fetchPointSettings, pointValueFor, usePointsEnabled } from '../services/loyalty/pointValue';
import { recordTillPoints } from '../services/loyalty/tillPoints';
import { SheetLayer } from '../components/shared/SheetLayer';
import { SwipeRow } from '../components/shared/SwipeRow';
import React, { useState, useEffect, useRef, useMemo, useDeferredValue, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../stores/authStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useCustomerStore } from '../stores/customerStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useBusinessStore } from '../stores/businessStore';
import { Product, ProductCategory, PaymentMethod, Transaction, MoneyMethod, PAYMENT_TERMS_LABELS, type DeliveryMode } from '../types';
import { usePaymentMethods } from '../hooks/usePaymentMethods';
import {
  ShoppingCart,
  Search,
  User,
  Trash2,
  Users,
  Tag,
  Percent,
  Plus,
  ArrowLeft,
  CheckCircle2,
  Truck,
  RefreshCw,
  ReceiptText,
  Keyboard,
  X,
  FileSignature,
  PauseCircle,
} from 'lucide-react';
import { hasRolePermission } from '../utils/permissions';
import { motion, AnimatePresence } from 'motion/react';
import SearchableDropdown from '../components/SearchableDropdown';
import { titleCase, sentenceCase, searchMatch } from '../utils/stringUtils';
import { formatReceiptNumber } from '../utils/idUtils';
import { getSupabase } from '../services/supabaseClient';
import { QuantityInput } from '../components/shared/QuantityInput';
import { Switch } from '../components/shared/Switch';
import { DeliveryZone, fetchActiveZones } from '../components/DeliveryZonesEditor';
import { formatLocation } from '../../website/src/customerProfile';
import { ReceiptSheet } from '../components/receipts/ReceiptSheet';
import { ReceiptService } from '../services/receipt/ReceiptService';
import PaymentCodeField from '../components/payments/PaymentCodeField';
import { needsPaymentCode, paymentCodeProblem } from '../utils/paymentProof';
import CardChargeSheet, { type CardChargeResult, describeCard } from '../components/payments/CardChargeSheet';
import { CardRepository } from '../services/repositories';
import { useCartStore } from '../stores/cartStore';
import { markQuoteSold } from '../services/salesDocs';
import QuoteFromCartSheet from '../components/sales/QuoteFromCartSheet';
import { useVatPercent } from '../services/kra/kraService';
import { promoCheck, promoReserve, promoRelease, type PromoResult } from '../services/promotions';
import { NumberInput } from '../components/shared/Input';
import { formatCurrency } from '../utils/helpers';
import { formatMoney, roundMoney } from '../utils/money';


// The three ways a delivery is paid at the till (see DeliveryMode in types.ts).
const DELIVERY_MODES: { value: DeliveryMode; label: string; help: (onCredit: boolean) => string }[] = [
  {
    value: 'charged',
    label: 'On our bill',
    help: (onCredit) =>
      onCredit
        ? 'The fee goes on their account with the goods; they pay it later. We pay the rider, who collects nothing.'
        : 'The fee is added to the bill and paid to us. We pay the rider, who collects nothing.',
  },
  {
    value: 'rider_collects',
    label: 'Pay the rider',
    help: () => "Not on our bill. The customer pays the rider the fee in cash and the rider keeps it.",
  },
  {
    value: 'free',
    label: 'Free',
    help: () => "The customer isn't charged. We pay the rider from our own money.",
  },
];

export default function POSView() {
  // Each store is read for just what the till uses, so a toast, a notification or another
  // screen's data doesn't redraw every product card.
  const { businesses, activeBusinessId } = useBusinessStore(
    useShallow((s) => ({ businesses: s.businesses, activeBusinessId: s.activeBusinessId })),
  );
  const { allProducts, productCategories } = useInventoryStore(
    useShallow((s) => ({ allProducts: s.products, productCategories: s.categories })),
  );
  const allCustomers = useCustomerStore((s) => s.customers);
  const { cart, selectedCustomer, addToCart, removeFromCart, updateCartQty, updateCartDiscount, selectCustomer, checkout, clearCart, holdSale, resumeHeld } =
    useCartStore(
      useShallow((s) => ({
        cart: s.cart,
        selectedCustomer: s.selectedCustomer,
        addToCart: s.addToCart,
        removeFromCart: s.removeFromCart,
        updateCartQty: s.updateCartQty,
        updateCartDiscount: s.updateCartDiscount,
        selectCustomer: s.selectCustomer,
        checkout: s.checkout,
        clearCart: s.clearCart,
        holdSale: s.holdSale,
        resumeHeld: s.resumeHeld,
      })),
    );
  const isOnline = useTransactionStore((s) => s.isOnline);
  const { employees, currentEmployee } = useAuthStore(
    useShallow((s) => ({ employees: s.employees, currentEmployee: s.currentEmployee })),
  );
  const showToast = useNotificationStore((s) => s.showToast);
  const products = useMemo(
    () => (Array.isArray(allProducts) ? allProducts : []).filter((p) => p.businessId === activeBusinessId),
    [allProducts, activeBusinessId],
  );
  const customers = useMemo(
    () => (Array.isArray(allCustomers) ? allCustomers : []).filter((c) => c.businessId === activeBusinessId),
    [allCustomers, activeBusinessId],
  );

  const [activeCategory, setActiveCategory] = useState<ProductCategory | 'All'>(
    'All',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const cartQuote = useCartStore((s) => s.quote);
  const heldSales = useCartStore((s) => s.held);
  const dropHeld = useCartStore((s) => s.dropHeld);
  const [dropConfirm, setDropConfirm] = useState<string | null>(null);
  // Only the methods this business has switched on; Credit is a sale on debt, always offered.
  const enabledMethods = usePaymentMethods();
  // M-Pesa first (most sales), else the first method switched on.
  const defaultMethod: PaymentMethod = enabledMethods.includes('M-Pesa') ? 'M-Pesa' : (enabledMethods[0] ?? 'Credit_Debt');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(defaultMethod);
  const payChoices = (
    [
      { value: 'Cash', label: 'Cash', shortcut: 'pos-cash' },
      { value: 'M-Pesa', label: 'M-Pesa', shortcut: 'pos-mpesa' },
      { value: 'Airtel Money', label: 'Airtel', shortcut: 'pos-airtel' },
      { value: 'Card', label: 'Card', shortcut: 'pos-card' },
      { value: 'Bank', label: 'Bank', shortcut: 'pos-bank' },
      { value: 'Credit_Debt', label: 'Credit', shortcut: 'pos-credit' },
    ] as const
  ).filter((m) => m.value === 'Credit_Debt' || enabledMethods.includes(m.value));
  useEffect(() => {
    if (paymentMethod !== 'Credit_Debt' && !enabledMethods.includes(paymentMethod as MoneyMethod)) {
      setPaymentMethod(defaultMethod);
    }
  }, [enabledMethods, paymentMethod, defaultMethod]);

  // A customer who pays weekly or monthly buys on credit, so choosing them picks Credit.
  // Taking them off (or choosing a pay-now customer) puts back the default, but only if
  // Credit was picked for them; a method the cashier chose stays.
  const autoCredit = useRef(false);
  const customerTerms = selectedCustomer?.paymentTerms;
  const paysLater = customerTerms === 'weekly' || customerTerms === 'monthly';
  useEffect(() => {
    if (paysLater) {
      autoCredit.current = true;
      setPaymentMethod('Credit_Debt');
    } else if (autoCredit.current) {
      autoCredit.current = false;
      setPaymentMethod(defaultMethod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer?.id, paysLater]);
  // Card: the sheet takes the card first, then the sale is saved. A card already paid is kept
  // here, so if saving the sale fails, trying again doesn't charge the card twice.
  const [cardSheetOpen, setCardSheetOpen] = useState(false);
  const [paidCard, setPaidCard] = useState<CardChargeResult | null>(null);
  const [note, setNote] = useState('');
  // Money first: the M-Pesa / Airtel code or bank reference of the payment, typed before saving.
  const [paymentRef, setPaymentRef] = useState('');
  const [showRefError, setShowRefError] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [lastTxId, setLastTxId] = useState('');
  const [lastTx, setLastTx] = useState<Transaction | null>(null);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [receiptAutoPrint, setReceiptAutoPrint] = useState(false);

  // On the "sale recorded" card, R opens the receipt and Enter/Escape closes the card.
  useEffect(() => {
    if (!checkoutSuccess) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey) return;
      // R or Alt+R (Alt+R is the receipt key in Quick Sale too).
      if (e.code === 'KeyR' && lastTx) {
        e.preventDefault();
        setCheckoutSuccess(false);
        setReceiptAutoPrint(false);
        setReceiptTx(lastTx);
      } else if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        setCheckoutSuccess(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkoutSuccess, lastTx]);
  const activeBusiness = businesses.find((b) => b.id === activeBusinessId);
  // No VAT at all unless KRA eTIMS is connected, whatever the tax switch says.
  const businessTaxRate = useVatPercent(activeBusiness) / 100;
  const [taxRate, setTaxRate] = useState<number>(businessTaxRate);

  useEffect(() => {
    setTaxRate(businessTaxRate);
  }, [activeBusinessId, businessTaxRate]);
  const [cartDiscountType, setCartDiscountType] = useState<
    'percent' | 'amount'
  >('percent');
  const [cartDiscountValue, setCartDiscountValue] = useState<number>(0);

  // Delivery states
  const [isDelivery, setIsDelivery] = useState(false);
  // Delivery orders and riders are the Deliveries module (Pro and up).
  const deliveriesOn = useModule('deliveries');
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  // How the delivery is paid: on our bill (now or on their account), to the rider in cash,
  // or free. The fee typed is what the rider earns; only 'charged' adds it to our total.
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('charged');
  const customerPaysDelivery = isDelivery && deliveryMode === 'charged';
  const [riderName, setRiderName] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [pointsToUse, setPointsToUse] = useState('');
  // A promotion or referral code. The server works out what it gives; the till only shows it.
  // promoCode is the applied code; promo is the server's latest answer for this cart.
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promo, setPromo] = useState<PromoResult | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const canPromo = !!currentEmployee && hasRolePermission(currentEmployee.role, 'pos.apply_promotion');
  // A point's value depends on the customer's tier (the till checks again when spending).
  const [pointSettings, setPointSettings] = useState(DEFAULT_POINT_SETTINGS);
  useEffect(() => {
    if (activeBusinessId) fetchPointSettings(activeBusinessId).then(setPointSettings);
  }, [activeBusinessId]);
  const pointsOn = usePointsEnabled(activeBusinessId) && pointSettings.enabled;

  // Riders set the area prices; the till offers them as quick fees.
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  useEffect(() => {
    if (!activeBusinessId || !isDelivery) return;
    fetchActiveZones(activeBusinessId).then(setDeliveryZones).catch(() => setDeliveryZones([]));
  }, [activeBusinessId, isDelivery]);

  // Delivery for a customer with a saved location: fill it in (and their area's fee) unless
  // the cashier typed something else. Picking another customer replaces what was filled in.
  const filledLocation = React.useRef('');
  useEffect(() => {
    if (!isDelivery || !selectedCustomer) return;
    const zone = deliveryZones.find((z) => z.id === selectedCustomer.deliveryZoneId);
    const saved = formatLocation({
      zoneName: zone?.name,
      address: selectedCustomer.deliveryAddress,
      building: selectedCustomer.deliveryBuilding,
      landmark: selectedCustomer.deliveryLandmark,
    });
    if (!saved) return;
    setDeliveryLocation((current) => {
      const typed = current.trim() && current !== filledLocation.current && !deliveryZones.some((z) => z.name === current.trim());
      if (typed) return current;
      filledLocation.current = saved;
      return saved;
    });
    if (zone) setDeliveryFee((fee) => (fee > 0 ? fee : Number(zone.fee)));
  }, [isDelivery, selectedCustomer?.id, deliveryZones]);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const riders = employees.filter((emp) => emp.role === 'Rider');

  const categories: (ProductCategory | 'All')[] = ['All', ...productCategories];

  // Typing stays quick on a big catalogue: the grid catches up a moment later.
  const deferredQuery = useDeferredValue(searchQuery);
  const filteredProducts = useMemo(
    () =>
      products.filter((p) => {
        const matchesCategory = activeCategory === 'All' || p.category === activeCategory;
        const matchesSearch = searchMatch(p.name, deferredQuery) || searchMatch(p.sku, deferredQuery);
        return matchesCategory && matchesSearch;
      }),
    [products, activeCategory, deferredQuery],
  );
  const cartQtyById = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of cart) m.set(item.product.id, item.quantity);
    return m;
  }, [cart]);

  // ── Big screens and keyboard ──────────────────────────────────────────
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setIsWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState(-1);
  useEffect(() => setHighlight(searchQuery.trim() ? 0 : -1), [searchQuery, activeCategory]);
  useEffect(() => {
    if (highlight >= 0) document.getElementById(`pos-product-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  // Calculate Totals
  let totalOriginal = 0;
  let totalItemDiscount = 0;
  cart.forEach((item) => {
    const itemTotal = item.product.price * item.quantity;
    totalOriginal += itemTotal;
    totalItemDiscount += itemTotal * (item.discountPercentage / 100);
  });
  totalOriginal = roundMoney(totalOriginal);
  totalItemDiscount = roundMoney(totalItemDiscount);

  const subtotalBeforeCartDiscount = totalOriginal - totalItemDiscount;
  let cartDiscount = 0;
  if (cartDiscountValue > 0) {
    if (cartDiscountType === 'percent') {
      cartDiscount = subtotalBeforeCartDiscount * (cartDiscountValue / 100);
    } else {
      cartDiscount = cartDiscountValue;
    }
  }
  // Cap cartDiscount
  cartDiscount = roundMoney(Math.min(cartDiscount, subtotalBeforeCartDiscount));

  // Points the customer is using, at the business's value per point (the till checks again)
  const pointsNum = pointsOn && selectedCustomer ? Math.min(Math.max(0, Math.floor(Number(pointsToUse) || 0)), selectedCustomer.loyaltyPoints || 0) : 0;
  const pointValue = pointValueFor(pointSettings, selectedCustomer?.tier);
  const pointsDiscount = Math.min(Math.round(pointsNum * pointValue * 100) / 100, subtotalBeforeCartDiscount - cartDiscount);

  // Cart discount and points already taken off: a code that can't be combined is refused.
  const otherDiscount = cartDiscount + pointsDiscount;
  const promoDiscount = promoCode && promo?.ok
    ? Math.min(Number(promo.discount) || 0, Math.max(0, subtotalBeforeCartDiscount - otherDiscount))
    : 0;
  const subtotal = roundMoney(subtotalBeforeCartDiscount - cartDiscount - pointsDiscount - promoDiscount);
  const totalDiscount = roundMoney(totalItemDiscount + cartDiscount);
  // Money is stored to the cent, so the till works to the cent: what it shows is what is saved.
  const tax = roundMoney(subtotal * taxRate);
  const finalTotal = roundMoney(subtotal + tax + (customerPaysDelivery ? deliveryFee : 0));
  // On credit, the customer's wallet pays first (the server does the same).
  const walletCovers = selectedCustomer ? Math.min(Math.max(0, selectedCustomer.walletBalance || 0), Math.round(finalTotal * 100) / 100) : 0;

  // The applied code is checked again whenever the cart, customer or other discounts change.
  const cartKey = cart.map((i) => `${i.product.id}:${i.quantity}:${i.product.price}:${i.discountPercentage}`).join('|');
  const otherKey = Math.round(otherDiscount * 100);
  useEffect(() => {
    if (!promoCode || !activeBusinessId) return;
    if (cart.length === 0) {
      setPromoCode(null);
      setPromo(null);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const r = await promoCheck(activeBusinessId, promoCode, selectedCustomer?.id ?? null, useCartStore.getState().cart, otherKey / 100);
        if (!stale) setPromo(r);
      } catch (e) {
        if (!stale) setPromo({ ok: false, reason: toUserMessage(e, 'Could not check the code. Try again.') });
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoCode, cartKey, selectedCustomer?.id, otherKey, activeBusinessId]);

  const applyPromo = async () => {
    const code = promoInput.trim();
    if (!code || !activeBusinessId || promoBusy) return;
    if (!isOnline) {
      setPromoCode(null);
      setPromo({ ok: false, reason: 'Codes need an internet connection.' });
      return;
    }
    setPromoBusy(true);
    try {
      const r = await promoCheck(activeBusinessId, code, selectedCustomer?.id ?? null, cart, otherDiscount);
      setPromo(r);
      setPromoCode(r.ok ? r.code ?? code : null);
      if (r.ok) setPromoInput('');
    } catch (e) {
      setPromoCode(null);
      setPromo({ ok: false, reason: toUserMessage(e, 'Could not check the code. Try again.') });
    } finally {
      setPromoBusy(false);
    }
  };
  const removePromo = () => {
    setPromoCode(null);
    setPromo(null);
  };

  const refundPoints = async (redemptionId: string | null) => {
    if (!redemptionId) return;
    const { error } = await getSupabase().rpc('refund_till_points', { p_redemption_id: redemptionId });
    if (error) console.error('Could not return points after a failed sale:', error.code);
  };

  // The card is already paid, so the cashier must know not to charge it again.
  const cardFailNote = (card: CardChargeResult | null, message: string) =>
    card ? `${message} The card is already paid (${card.reference}); press Complete sale again and it won't be charged twice.` : message;

  // A failed sale shows in the cart and pops up like everywhere else, so it can't go unseen
  const failCheckout = (message: string) => {
    setCheckoutError(message);
    showToast('Sale not completed', message, undefined, 'error');
  };

  /** Puts the sheet back to a fresh sale (after a sale, or when one is held). */
  const resetSaleForm = () => {
    setNote('');
    setPaymentRef('');
    setShowRefError(false);
    setCartDiscountType('percent');
    setCartDiscountValue(0);
    setTaxRate(businessTaxRate);
    setIsDelivery(false);
    setDeliveryFee(0);
    setDeliveryMode('charged');
    // The next sale starts on the default method again (or Credit for a pay-later customer).
    autoCredit.current = false;
    setPaymentMethod(defaultMethod);
    setRiderName('');
    setSelectedRiderId('');
    setDeliveryLocation('');
    setPointsToUse('');
    setPromoCode(null);
    setPromo(null);
    setPromoInput('');
    setCheckoutError(null);
  };

  // Hold: park this customer's cart and serve the next one. Nothing is sold, paid or taken
  // from stock until the held cart is resumed and completed like any other sale.
  const saleExtras = (): Record<string, unknown> => ({
    note, cartDiscountType, cartDiscountValue, isDelivery, deliveryFee, deliveryMode,
    riderName, selectedRiderId, deliveryLocation, paymentMethod,
  });
  const holdCurrentSale = () => {
    if (cart.length === 0 || isCheckingOut) return;
    if (paidCard) {
      showToast("Can't hold this sale", 'A card has already been paid for it. Complete the sale first.', undefined, 'error');
      return;
    }
    const entry = holdSale(saleExtras());
    if (!entry) return;
    const hadCode = !!promoCode;
    resetSaleForm();
    showToast('Sale on hold',
      `${entry.label} is waiting. Resume it from the held list in the cart.${hadCode ? ' Enter the promotion code again when you resume.' : ''}`,
      undefined, 'success');
  };
  const resumeHeldSale = (id: string) => {
    if (isCheckingOut) return;
    if (paidCard) {
      showToast("Can't switch sales", 'A card has already been paid for this cart. Complete the sale first.', undefined, 'error');
      return;
    }
    const hadCart = cart.length > 0;
    const res = resumeHeld(id, saleExtras());
    if (!res) return;
    if (res.changed < 0) {
      showToast('Still on hold', 'None of its items are in stock now. Restock, or remove the held sale.', undefined, 'error');
      return;
    }
    resetSaleForm();
    const x = res.extras ?? {};
    if (typeof x.note === 'string') setNote(x.note);
    if (x.cartDiscountType === 'percent' || x.cartDiscountType === 'amount') setCartDiscountType(x.cartDiscountType);
    if (typeof x.cartDiscountValue === 'number') setCartDiscountValue(x.cartDiscountValue);
    if (typeof x.isDelivery === 'boolean') setIsDelivery(x.isDelivery && deliveriesOn);
    if (typeof x.deliveryFee === 'number') setDeliveryFee(x.deliveryFee);
    if (x.deliveryMode === 'charged' || x.deliveryMode === 'rider_collects' || x.deliveryMode === 'free') setDeliveryMode(x.deliveryMode as DeliveryMode);
    if (typeof x.riderName === 'string') setRiderName(x.riderName);
    if (typeof x.selectedRiderId === 'string') setSelectedRiderId(x.selectedRiderId);
    if (typeof x.deliveryLocation === 'string') setDeliveryLocation(x.deliveryLocation);
    if (typeof x.paymentMethod === 'string') setPaymentMethod(x.paymentMethod as PaymentMethod);
    if (res.changed > 0) {
      showToast('Cart updated', `${res.changed} ${res.changed === 1 ? 'line was' : 'lines were'} changed to today's price or stock.`, undefined, 'info');
    } else if (hadCart) {
      showToast('Sales swapped', 'The cart you had is now on hold.', undefined, 'success');
    }
  };

  const handleCheckout = async (cardArg?: CardChargeResult) => {
    if (isCheckingOut) return;
    // A code must be good before any card is charged.
    if (promoCode && !promo?.ok) {
      failCheckout(`The code ${promoCode} can't be used: ${promo?.reason ?? 'it is still being checked'} Remove it, or change the cart.`);
      return;
    }
    if (promoCode && !isOnline) {
      failCheckout('Codes need an internet connection. Remove the code, or try again when you are back online.');
      return;
    }
    // Money first: an M-Pesa, Airtel or bank sale is saved only with the payment's code.
    const refProblem = paymentCodeProblem(paymentMethod, paymentRef);
    if (refProblem) {
      setShowRefError(true);
      failCheckout(refProblem);
      if (!isWide) setIsCartOpen(true);
      setTimeout(() => document.getElementById('pos-payment-ref')?.focus(), 60);
      return;
    }
    let card: CardChargeResult | null = null;
    if (paymentMethod === 'Card') {
      if (cart.length === 0) return;
      card = cardArg ?? paidCard;
      if (!card) {
        setCheckoutError(null);
        setCardSheetOpen(true);
        return;
      }
      if (Math.abs(card.amountPaid - Math.round(finalTotal * 100) / 100) > 0.009) {
        failCheckout(`The card paid ${formatCurrency(card.amountPaid)} (ref ${card.reference}) but the sale is now ${formatCurrency(finalTotal)}. Put the cart back to that amount, or refund the card in Paystack and start again.`);
        return;
      }
    }
    setIsCheckingOut(true);
    setCheckoutError(null);
    let redemptionId: string | null = null;
    let promoHold: { redemptionId: string; code?: string; discount: number } | null = null;
    let pointsSpent: { points: number; value: number } | null = null;
    try {
      // Points come off first and count as a discount; if the sale fails they're given back.
      let discountType = cartDiscountType;
      let discountValue = cartDiscountValue;
      const points = Number(pointsToUse);
      if (pointsOn && selectedCustomer && points > 0) {
        const { data, error } = await getSupabase().rpc('spend_points_at_till', {
          p_customer_id: selectedCustomer.id,
          p_points: points,
          p_recorded_by: currentEmployee?.name ?? 'Staff',
        });
        if (error) throw error;
        redemptionId = data.redemptionId;
        pointsSpent = { points, value: Number(data.value) || 0 };
        discountType = 'amount';
        discountValue = cartDiscount + Number(data.value);
      }
      // The code's use is held now; the discount charged is the server's, never the till's.
      if (promoCode && activeBusinessId) {
        const held = await promoReserve(activeBusinessId, promoCode, selectedCustomer?.id ?? null, cart,
          cartDiscount + (pointsSpent?.value ?? 0));
        promoHold = { redemptionId: held.redemptionId!, code: held.code, discount: Number(held.discount) || 0 };
        if (Math.abs(promoHold.discount - promoDiscount) > 0.009) {
          setPromo(held);
          await promoRelease(promoHold.redemptionId);
          await refundPoints(redemptionId);
          failCheckout(cardFailNote(card, `The code now takes off ${formatCurrency(promoHold.discount)}, not ${formatCurrency(promoDiscount)}. Check the total and press again.`));
          return;
        }
        discountType = 'amount';
        discountValue = cartDiscount + (pointsSpent?.value ?? 0) + promoHold.discount;
      }
      const cardNote = card
        ? card.via === 'machine'
          ? `Card machine, approval ${card.reference}${card.last4 ? `, card •••• ${card.last4}` : ''}`
          : `Card ${describeCard(card.brand, card.last4)} (Paystack ${card.reference})`.replace('Card  (', 'Card (')
        : '';
      const saleNote = [
        isDelivery && deliveryLocation.trim() ? `Deliver to: ${deliveryLocation.trim()}` : '',
        cardNote,
        note,
      ].filter(Boolean).join('. ');
      const soldQuote = useCartStore.getState().quote;
      const result = await checkout(
        paymentMethod,
        saleNote,
        taxRate,
        discountType,
        discountValue,
        isDelivery,
        deliveryFee,
        isDelivery ? riderName : '',
        deliveryMode,
        promoHold,
        needsPaymentCode(paymentMethod) ? paymentRef : '',
      );
      if (result.success && result.transaction) {
        setPaidCard(null);
        if (card?.cardPaymentId && !result.offline) {
          await CardRepository.attachToSale(card.cardPaymentId, result.transaction.id).catch((e) =>
            console.error('Could not link the card payment to the sale:', e?.code));
        }
        // The receipt shows the points used; linked to the sale so reprints show them too
        if (redemptionId && pointsSpent) {
          await recordTillPoints(result.transaction.id, redemptionId, pointsSpent).catch(() => {});
        }
        // A sale made from a quote marks the quote sold (accepted) and links it to the sale.
        if (soldQuote && !result.offline) {
          await markQuoteSold(soldQuote.id, result.transaction.id).catch((e) =>
            console.error('Could not mark the quote sold:', e?.code));
        }
        setLastTxId(result.transaction.id);
        setLastTx(result.transaction);
        if (activeBusinessId && ReceiptService.getSettings(activeBusinessId).autoPrint) {
          setReceiptAutoPrint(true);
          setReceiptTx(result.transaction);
        } else {
          setCheckoutSuccess(true);
        }
        setIsCartOpen(false);
        resetSaleForm();

        // Send a professional toast popup notification on completed checkout action
        showToast(
          'Sale saved',
          `Sale of ${formatMoney(finalTotal)} saved (${paymentMethod.replace('_', ' ')}).`,
          undefined,
          'success',
        );
      } else {
        await refundPoints(redemptionId);
        await promoRelease(promoHold?.redemptionId);
        failCheckout(cardFailNote(card, result.error || 'The sale could not be saved. Try again.'));
      }
    } catch (err: any) {
      await refundPoints(redemptionId);
      await promoRelease(promoHold?.redemptionId);
      failCheckout(cardFailNote(card, toUserMessage(err, 'The sale could not be saved. Try again.')));
    } finally {
      setIsCheckingOut(false);
    }
  };


  // Keyboard shortcuts (press ? to see them). Ignored while typing, except the ones that
  // make sense in a field (F-keys, Ctrl+Enter, Esc).
  const lastItem = cart[cart.length - 1];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (checkoutSuccess || receiptTx) return; // the sale card and receipt have their own keys
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const inSearch = el === searchRef.current;
      const k = e.key;
      const done = () => e.preventDefault();

      if (k === 'F9' || (k === 'Enter' && (e.ctrlKey || e.metaKey))) {
        done();
        if (cart.length === 0) return;
        if (isWide || isCartOpen) handleCheckout();
        else {
          setCheckoutError(null);
          setIsCartOpen(true);
        }
        return;
      }
      if (k === 'F2' || (k === '/' && !typing)) {
        done();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (k === 'F4') {
        done();
        if (!isWide) setIsCartOpen((v) => !v);
        return;
      }
      if (k === 'Escape') {
        if (inSearch && searchQuery) return done(), setSearchQuery('');
        if (isCartOpen && !isWide) return done(), setIsCartOpen(false);
        if (typing) (el as HTMLElement).blur();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const methods: Record<string, PaymentMethod> = { '1': 'Cash', '2': 'M-Pesa', '3': 'Credit_Debt', '4': 'Card', '5': 'Bank', '6': 'Airtel Money' };
        if (methods[k] && (methods[k] === 'Credit_Debt' || enabledMethods.includes(methods[k] as MoneyMethod))) return done(), setPaymentMethod(methods[k]);
        const code = e.code;
        if (code === 'KeyD' && deliveriesOn) return done(), setIsDelivery((v) => !v);
        if (code === 'KeyH') {
          done();
          holdCurrentSale();
          return;
        }
        if (code === 'KeyQ') {
          done();
          if (cart.length > 0 && hasRolePermission(currentEmployee?.role || 'Guest', 'quotes.manage' as any)) setQuoting(true);
          return;
        }
        if (code === 'KeyC') {
          done();
          if (!isWide) setIsCartOpen(true);
          setTimeout(() => (document.querySelector('#pos-customer button, #pos-customer input') as HTMLElement | null)?.click(), 60);
          return;
        }
        if (code === 'KeyN') {
          done();
          if (!isWide) setIsCartOpen(true);
          setTimeout(() => document.getElementById('pos-note')?.focus(), 60);
          return;
        }
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          done();
          const i = categories.indexOf(activeCategory);
          const next = (i + (k === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
          setActiveCategory(categories[next]);
          return;
        }
      }
      if (inSearch && filteredProducts.length > 0) {
        if (k === 'ArrowDown') return done(), setHighlight((h) => Math.min(filteredProducts.length - 1, h + 1));
        if (k === 'ArrowUp') return done(), setHighlight((h) => Math.max(0, h - 1));
        if (k === 'Enter') {
          done();
          const product = filteredProducts[Math.max(0, highlight)];
          if (product && product.stock > 0) {
            addToCart(product);
            setSearchQuery('');
          } else if (product) showToast('Out of stock', `${titleCase(product.name)} is out of stock.`, undefined, 'info');
          return;
        }
      }
      if (typing) return;
      if (e.ctrlKey && (k === 'Delete' || k === 'Backspace')) {
        done();
        if (cart.length) {
          clearCart();
          showToast('Cart cleared', 'All items removed.', undefined, 'success');
        }
        return;
      }
      if (!lastItem) return;
      if (k === '+' || k === '=') return done(), updateCartQty(lastItem.product.id, lastItem.quantity + 1);
      if (k === '-') {
        done();
        if (lastItem.quantity > 1) updateCartQty(lastItem.product.id, lastItem.quantity - 1);
        else removeFromCart(lastItem.product.id);
        return;
      }
      if (k === 'Delete') return done(), removeFromCart(lastItem.product.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The cart: a bottom sheet on phones, a panel always beside the products on big screens
  const cartPanel = (
    <>
              {/* Drawer Header */}
              <div className="px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-sm font-semibold text-app-text">
                    Cart{cartCount > 0 ? ` · ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : ''}
                  </h2>
                  {cartQuote && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">From quote {cartQuote.number}, at the quoted prices</p>
                  )}
                 
                </div>
                <div className="flex items-center gap-1">
                {hasRolePermission(currentEmployee?.role || 'Guest', 'quotes.manage' as any) && (
                  <button
                    type="button"
                    // A customer who wants prices first: save the cart as a quote and send it.
                    onClick={() => setQuoting(true)}
                    disabled={cart.length === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 disabled:opacity-30 text-app-text hover:bg-app-bg rounded-xl ring-1 ring-app-border text-[11px] font-medium transition cursor-pointer"
                    data-shortcut="pos-quote"
                    title="Save this cart as a quote (Alt+Q)"
                    aria-label="Save this cart as a quote"
                  >
                    <FileSignature size={14} /> Quote
                  </button>
                )}
                <button
                  type="button"
                  onClick={holdCurrentSale}
                  disabled={cart.length === 0 || isCheckingOut}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 disabled:opacity-30 text-app-text hover:bg-app-bg rounded-xl ring-1 ring-app-border text-[11px] font-medium transition cursor-pointer"
                  data-shortcut="pos-hold"
                  title="Hold this sale and serve the next customer (Alt+H)"
                  aria-label="Hold this sale"
                >
                  <PauseCircle size={14} /> Hold
                </button>
                <button
                  onClick={clearCart}
                  disabled={cart.length === 0}
                  data-shortcut="pos-clear"
                  className="inline-flex items-center p-2 disabled:opacity-30 text-red-500 hover:bg-red-500/10 rounded-xl transition cursor-pointer"
                  title="Empty the cart (Ctrl+Delete)"
                >
                  <Trash2 size={15} />
                </button>
                </div>
              </div>

              {/* Drawer Body - Scrollable Items List */}
              <div className="@container flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {heldSales.length > 0 && (
                  <div className="flex flex-col gap-1.5" aria-label="Sales on hold">
                    <p className="text-[11px] font-medium text-app-text-muted">On hold · tap to resume</p>
                    <div className="flex flex-wrap gap-1.5">
                      {heldSales.map((h) => {
                        const items = h.cart.reduce((n, i) => n + i.quantity, 0);
                        const confirming = dropConfirm === h.id;
                        return (
                          <div key={h.id} className="inline-flex items-center rounded-xl ring-1 ring-amber-500/40 bg-amber-500/10 text-[11px]">
                            <button
                              type="button"
                              onClick={() => resumeHeldSale(h.id)}
                              disabled={isCheckingOut}
                              className="pl-2.5 pr-1.5 py-1.5 text-app-text font-medium cursor-pointer disabled:opacity-40"
                              title={`Held at ${new Date(h.heldAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                            >
                              {titleCase(h.label)} · {items} {items === 1 ? 'item' : 'items'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirming) { dropHeld(h.id); setDropConfirm(null); }
                                else setDropConfirm(h.id);
                              }}
                              onBlur={() => confirming && setDropConfirm(null)}
                              className={`px-1.5 py-1.5 rounded-r-xl cursor-pointer ${confirming ? 'text-red-600 font-semibold' : 'text-app-text-muted hover:text-red-500'}`}
                              aria-label={confirming ? 'Tap again to throw this held sale away' : 'Throw this held sale away'}
                            >
                              {confirming ? 'Remove?' : <X size={12} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* Cart Items Checklist with themed cards */}
                <div className="flex flex-col gap-2">
                  {cart.length === 0 && (
                    <div className="py-10 text-center text-app-text-muted">
                      <ShoppingCart size={26} className="mx-auto opacity-40" />
                      <p className="text-sm font-medium text-app-text mt-2">The cart is empty</p>
                      <p className="text-xs mt-1">Tap a product, or search and press Enter.</p>
                    </div>
                  )}
                  {cart.map((item) => {
                    const lineTotalOriginal =
                      item.product.price * item.quantity;
                    const lineTotalDisc =
                      lineTotalOriginal * (item.discountPercentage / 100);

                    const cycleDiscount = () =>
                      updateCartDiscount(item.product.id, item.discountPercentage === 0 ? 10 : item.discountPercentage === 10 ? 20 : 0);
                    return (
                      <SwipeRow
                        key={item.product.id}
                        title={titleCase(item.product.name)}
                        subtitle={`${item.quantity} × ${formatCurrency(item.product.price)}`}
                        surfaceClassName="bg-app-bg"
                        // Taking a line out of the cart is undone by adding it again, so the
                        // paused swipe's Remove button is the only check.
                        actions={[{ label: 'Remove', icon: <Trash2 size={18} />, tone: 'red', onClick: () => removeFromCart(item.product.id) }]}
                        more={[
                          { label: 'Add one more', icon: <Plus size={16} />, onClick: () => updateCartQty(item.product.id, item.quantity + 1) },
                          {
                            label: item.discountPercentage === 0 ? 'Give 10% off' : item.discountPercentage === 10 ? 'Make it 20% off' : 'Remove discount',
                            icon: <Percent size={16} />,
                            onClick: cycleDiscount,
                          },
                          { label: 'Remove from cart', icon: <Trash2 size={16} />, tone: 'red', onClick: () => removeFromCart(item.product.id) },
                        ]}
                        className="rounded-2xl border border-app-border"
                        contentClassName="p-3 flex items-center justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-app-text truncate">
                            {titleCase(item.product.name)}
                          </h4>
                          <span className="text-[10px] text-app-text-muted block mt-0.5">
                            {formatCurrency(item.product.price)} each ·{' '}
                            {item.product.sku}
                          </span>
                        </div>

                        {/* Adjust qty & Discount */}
                        <div className="flex items-center gap-3">
                          {/* Qty Counter using theme styles */}
                          <QuantityInput item={item} updateCartQty={updateCartQty} removeFromCart={removeFromCart} />

                          {/* Item Discount Toggle */}
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                const nextDisc =
                                  item.discountPercentage === 0
                                    ? 10
                                    : item.discountPercentage === 10
                                    ? 20
                                    : 0;
                                updateCartDiscount(item.product.id, nextDisc);
                              }}
                              className={`p-1.5 rounded-lg border text-[10px] font-bold transition flex items-center gap-1 cursor-pointer ${
                                item.discountPercentage > 0
                                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-500'
                                  : 'bg-transparent border-app-border text-app-text-muted hover:bg-app-bg'
                              }`}
                              title="Toggle Item Discount"
                            >
                              <Percent size={10} />
                              <span>
                                {item.discountPercentage > 0
                                  ? `${item.discountPercentage}%`
                                  : 'Disc'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </SwipeRow>
                    );
                  })}
                </div>

                {/* Assign Customer Profile with themed container */}
                <div data-shortcut="pos-customer" className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-bold text-app-text">
                    <span className="flex items-center gap-1.5 text-amber-500">
                      <User size={13} />
                      <span data-kbd-here>Customer</span>
                    </span>
                    {selectedCustomer && (
                      <button
                        onClick={() => selectCustomer(null)}
                        className="text-[10px] text-red-500 cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {selectedCustomer ? (
                    <div className="text-xs">
                      <p className="font-bold text-app-text">
                        {selectedCustomer.name}
                      </p>
                      <p className="text-[10px] text-app-text-muted mt-0.5">
                        Tier:{' '}
                        <span className="text-amber-500 font-bold">
                          {selectedCustomer.tier}
                        </span>
                        {' · '}
                        {PAYMENT_TERMS_LABELS[selectedCustomer.paymentTerms ?? 'pay_now']}
                      </p>
                      {paysLater && (
                        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                          {paymentMethod === 'Credit_Debt'
                            ? `Credit picked: they pay ${customerTerms}.`
                            : `They usually pay ${customerTerms}; this sale is ${paymentMethod.replace('_', ' ')}.`}
                        </p>
                      )}
                      <div className={`grid ${pointsOn ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 mt-1.5`}>
                        {pointsOn && (
                          <div className="rounded-lg bg-app-bg px-2 py-1">
                            <div className="text-[10px] text-app-text-muted">Points</div>
                            <div className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">{(selectedCustomer.loyaltyPoints || 0).toLocaleString()}</div>
                          </div>
                        )}
                        <div className="rounded-lg bg-app-bg px-2 py-1">
                          <div className="text-[10px] text-app-text-muted">Wallet</div>
                          <div className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(selectedCustomer.walletBalance || 0)}</div>
                        </div>
                        <div className="rounded-lg bg-app-bg px-2 py-1">
                          <div className="text-[10px] text-app-text-muted">Owes</div>
                          <div className={`font-bold tabular-nums ${(selectedCustomer.debtBalance || 0) > 0 ? 'text-red-500' : 'text-app-text'}`}>{formatCurrency(selectedCustomer.debtBalance || 0)}</div>
                        </div>
                      </div>
                      {paymentMethod === 'Credit_Debt' && finalTotal > 0 && (
                        <p className="mt-1.5 text-[11px] text-app-text">
                          {walletCovers > 0 ? (
                            <>
                              {formatCurrency(walletCovers)} comes from the wallet
                              {finalTotal - walletCovers > 0
                                ? `, ${formatCurrency(finalTotal - walletCovers)} goes on credit.`
                                : '. Nothing goes on credit.'}
                            </>
                          ) : (
                            <>The whole {formatCurrency(finalTotal)} goes on credit.</>
                          )}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div id="pos-customer">
                    <SearchableDropdown
                      items={customers.map((cust) => ({
                        id: cust.id,
                        label: cust.name,
                        sublabel: [
                          cust.phone,
                          `${cust.tier}`,
                          pointsOn ? `${(cust.loyaltyPoints || 0).toLocaleString()} pts` : '',
                          (cust.walletBalance || 0) > 0 ? `Wallet ${formatCurrency(cust.walletBalance || 0)}` : '',
                          (cust.debtBalance || 0) > 0 ? `Owes ${formatCurrency(cust.debtBalance || 0)}` : '',
                        ].filter(Boolean).join(' · '),
                      }))}
                      selectedValue=""
                      onChange={(val) => {
                        const matched = customers.find((c) => c.id === val);
                        if (matched) selectCustomer(matched);
                      }}
                      placeholder="Choose a customer (optional)"
                      searchPlaceholder="Name or phone"
                    />
                    </div>
                  )}
                </div>

                {/* Payment on its own row (the methods switched on, plus Credit), then the note */}
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-app-text-muted">
                      Payment
                    </label>
                    <div
                      className="h-10 lg:h-12 grid gap-1 bg-app-bg p-1 rounded-xl border border-app-border"
                      style={{ gridTemplateColumns: `repeat(${payChoices.length}, minmax(0, 1fr))` }}
                      role="radiogroup"
                      aria-label="Payment"
                    >
                      {payChoices.map((method) => (
                        <button
                          key={method.value}
                          type="button"
                          role="radio"
                          aria-checked={paymentMethod === method.value}
                          data-shortcut={method.shortcut}
                          onClick={() => {
                            setPaymentMethod(method.value);
                            if (method.value !== 'Card') setPaidCard(null);
                          }}
                          className={`kbd-stack rounded-lg text-[11px] font-semibold leading-tight transition cursor-pointer ${
                            paymentMethod === method.value
                              ? 'bg-amber-500 text-slate-950 shadow'
                              : 'text-app-text-muted hover:bg-app-bg'
                          }`}
                        >
                          {method.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {needsPaymentCode(paymentMethod) && cart.length > 0 && (
                    <PaymentCodeField
                      id="pos-payment-ref"
                      method={paymentMethod}
                      amount={finalTotal}
                      value={paymentRef}
                      onChange={(v) => { setPaymentRef(v); setCheckoutError(null); }}
                      showError={showRefError}
                    />
                  )}

                  <div data-shortcut="pos-note" className="flex flex-col gap-1.5">
                    <label htmlFor="pos-note" data-kbd-here className="text-[11px] font-semibold text-app-text-muted">
                      Note
                    </label>
                    <input
                      type="text"
                      placeholder="Optional"
                      id="pos-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="h-10 w-full min-w-0 bg-app-bg border border-app-border rounded-xl px-3 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>

                {/* Delivery Settings */}
                {deliveriesOn && (
                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex flex-col gap-2.5">
                  <div data-shortcut="pos-delivery" className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-amber-500 text-xs font-bold">
                      <Truck size={13} />
                      <span data-kbd-here>Delivery</span>
                    </span>
                    <Switch
                      ariaLabel="Set as delivery order"
                      checked={isDelivery}
                      onChange={(on) => {
                        setIsDelivery(on);
                        if (!on) {
                          setDeliveryFee(0);
                          setDeliveryMode('charged');
                          setRiderName('');
                          setSelectedRiderId('');
                        }
                      }}
                    />
                  </div>

                  {isDelivery && (
                    <div className="space-y-3 pt-2 border-t border-app-border/40 animate-fade-in">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold text-app-text-muted">How delivery is paid</span>
                        <div className="grid grid-cols-3 gap-1 bg-app-bg p-1 rounded-xl border border-app-border" role="radiogroup" aria-label="How delivery is paid">
                          {DELIVERY_MODES.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              role="radio"
                              aria-checked={deliveryMode === o.value}
                              onClick={() => setDeliveryMode(o.value)}
                              className={`min-h-9 px-1 rounded-lg text-[11px] font-bold leading-tight transition cursor-pointer ${
                                deliveryMode === o.value ? 'bg-amber-500 text-slate-950 shadow' : 'text-app-text-muted hover:bg-app-card'
                              }`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-app-text-muted">
                          {DELIVERY_MODES.find((o) => o.value === deliveryMode)!.help(paymentMethod === 'Credit_Debt')}
                        </p>
                      </div>
                      {deliveryZones.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold text-app-text-muted">Area</span>
                          <div className="flex flex-wrap gap-1.5">
                            {deliveryZones.map((zone) => {
                              const chosen = deliveryFee === Number(zone.fee) && deliveryLocation.trim() === zone.name;
                              return (
                                <button
                                  key={zone.id}
                                  type="button"
                                  onClick={() => {
                                    setDeliveryFee(Number(zone.fee));
                                    // Only fill the location if nothing more exact was typed.
                                    if (!deliveryLocation.trim() || deliveryZones.some((z) => z.name === deliveryLocation.trim())) {
                                      setDeliveryLocation(zone.name);
                                    }
                                  }}
                                  className={`min-h-9 rounded-lg border px-2.5 text-[11px] font-bold transition cursor-pointer ${
                                    chosen
                                      ? 'border-amber-500 bg-amber-500 text-slate-950'
                                      : 'border-app-border bg-app-bg text-app-text hover:border-amber-500'
                                  }`}
                                >
                                  {zone.name} · {Number(zone.fee)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 @sm:grid-cols-2 gap-2.5">
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-app-text-muted">
                            {deliveryMode === 'charged' ? 'Fee (KSh)' : 'Rider gets (KSh)'}
                          </label>
                          <NumberInput
                            min={0}
                            placeholder="0"
                            value={deliveryFee || ''}
                            onChange={(v) => {
                              const val = (v ?? NaN);
                              setDeliveryFee(isNaN(val) ? 0 : val);
                            }}
                            size="sm" className="w-full min-w-0" inputClassName="font-mono text-right"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-app-text-muted">
                            Quick fee
                          </label>
                          <div className="h-10 grid grid-cols-3 gap-1 bg-app-bg p-1 rounded-xl border border-app-border">
                            {[0, 150, 250].map((fee) => (
                              <button
                                key={fee}
                                type="button"
                                onClick={() => setDeliveryFee(fee)}
                                className={`rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                                  deliveryFee === fee
                                    ? 'bg-amber-500 text-slate-950 shadow'
                                    : 'text-app-text-muted hover:bg-app-bg'
                                }`}
                              >
                                {fee}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <label className="flex flex-col gap-1 text-[11px] font-semibold text-app-text-muted">
                        Location
                        <input
                          value={deliveryLocation}
                          onChange={(e) => setDeliveryLocation(e.target.value)}
                          placeholder="Estate, building, landmark"
                          className="w-full bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs font-medium normal-case text-app-text"
                        />
                      </label>

                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-app-text-muted">
                          Rider
                        </label>
                        <div className="space-y-2">
                          <SearchableDropdown
                            items={[
                              {
                                id: 'custom_name',
                                label: 'Type a name',
                              },
                              ...riders.map((r) => ({
                                id: r.name,
                                label: r.name,
                                sublabel: r.phone,
                              })),
                            ]}
                            selectedValue={selectedRiderId}
                            onChange={(val) => {
                              setSelectedRiderId(val);
                              if (val !== 'custom_name') {
                                setRiderName(val);
                              } else {
                                setRiderName('');
                              }
                            }}
                            placeholder="Any rider can accept"
                            searchPlaceholder="Search riders"
                          />
                          {!riderName.trim() && (
                            <p className="text-[10px] text-app-text-muted">
                              No rider: the first to accept takes it.
                            </p>
                          )}

                          {(selectedRiderId === 'custom_name' ||
                            !riders.some(
                              (r) => r.name === selectedRiderId,
                            )) && (
                            <input
                              type="text"
                              placeholder="Rider's name"
                              value={riderName}
                              onChange={(e) => setRiderName(e.target.value)}
                              className="w-full bg-app-bg border border-app-border rounded-xl px-3 py-1.5 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                )}

                {pointsOn && selectedCustomer && selectedCustomer.loyaltyPoints > 0 && (
                  <label className="flex flex-col gap-1 p-3 bg-app-bg/50 border border-app-border rounded-2xl text-xs font-medium text-app-text">
                    Use points ({selectedCustomer.loyaltyPoints.toLocaleString()} available)
                    <NumberInput decimals={0}
                      min={0}
                      max={selectedCustomer.loyaltyPoints}
                      value={pointsToUse}
                      onChange={(v) => setPointsToUse((v == null ? '' : String(v)))}
                      placeholder="Points to take off this sale"
                      size="sm"
                    />
                  </label>
                )}

                {/* Additional Checkout Controls: Tax & Discount */}
                <div className={`grid grid-cols-1 ${businessTaxRate > 0 ? '@md:grid-cols-2' : ''} gap-3 p-3 bg-app-bg/50 border border-app-border/60 rounded-2xl`}>
                  {/* Tax Rate Setting: only when VAT is allowed (eTIMS connected) */}
                  {businessTaxRate > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-app-text-muted">
                      Tax
                    </label>
                    <div className="h-10 grid grid-cols-2 gap-1 bg-app-bg p-1 rounded-xl border border-app-border">
                      <button
                        type="button"
                        onClick={() => setTaxRate(businessTaxRate)}
                        className={`rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                          taxRate === businessTaxRate
                            ? 'bg-amber-500 text-slate-950 shadow'
                            : 'text-app-text-muted hover:bg-app-bg'
                        }`}
                      >
                        {(businessTaxRate * 100).toFixed(0)}% VAT
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaxRate(0.0)}
                        className={`rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                          taxRate === 0.0
                            ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-bold shadow-xs'
                            : 'text-app-text-muted hover:bg-app-bg'
                        }`}
                      >
                        No VAT
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Checkout Discount Setting */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-app-text-muted">
                      Discount
                    </label>
                    <div className="flex gap-1.5 min-w-0">
                      <div className="h-10 flex bg-app-bg p-1 rounded-xl border border-app-border shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setCartDiscountType('percent');
                            setCartDiscountValue(0);
                          }}
                          className={`px-3 rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                            cartDiscountType === 'percent'
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-app-text-muted'
                          }`}
                        >
                          %
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCartDiscountType('amount');
                            setCartDiscountValue(0);
                          }}
                          className={`px-2.5 rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                            cartDiscountType === 'amount'
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-app-text-muted'
                          }`}
                        >
                          KSh
                        </button>
                      </div>
                      <NumberInput
                        min={0}
                        placeholder="0"
                        aria-label={cartDiscountType === 'percent' ? 'Discount in percent' : 'Discount in KSh'}
                        value={cartDiscountValue || ''}
                        onChange={(v) => {
                          const val = (v ?? NaN);
                          setCartDiscountValue(isNaN(val) ? 0 : val);
                        }}
                        size="sm" className="flex-1 w-full min-w-0" inputClassName="text-right font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Promotion or referral code */}
                {canPromo && cart.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {!promoCode ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void applyPromo();
                        }}
                        className="flex gap-1.5"
                      >
                        <label className="sr-only" htmlFor="pos-promo-code">Promotion or referral code</label>
                        <div className="relative flex-1 min-w-0">
                          <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                          <input
                            id="pos-promo-code"
                            value={promoInput}
                            onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                            placeholder={isOnline ? 'Promotion or referral code' : 'Codes need internet'}
                            disabled={!isOnline}
                            autoCapitalize="characters"
                            autoComplete="off"
                            className="h-10 w-full bg-app-bg border border-app-border rounded-xl pl-8 pr-3 text-xs font-mono uppercase text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-60"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={!promoInput.trim() || promoBusy || !isOnline}
                          className="h-10 px-4 rounded-xl bg-app-text text-app-bg text-xs font-bold disabled:opacity-40 cursor-pointer"
                        >
                          {promoBusy ? 'Checking…' : 'Apply'}
                        </button>
                      </form>
                    ) : (
                      <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${promo?.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                        <Tag size={14} className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold font-mono">{promoCode}{promo?.ok && promo.summary ? <span className="font-sans font-semibold"> · {promo.summary}</span> : null}</p>
                          {promo?.ok && promo.referral && (
                            <p className="text-[11px] opacity-90">Referred by {promo.referrer}. They get {promo.referrerReward} after this sale.</p>
                          )}
                          {promo?.ok && promo.note && <p className="text-[11px] opacity-90">{promo.note}</p>}
                          {promo && !promo.ok && <p className="text-[11px]">{promo.reason}{promo.hint ? ` ${promo.hint}` : ''}</p>}
                        </div>
                        <button type="button" onClick={removePromo} aria-label={`Remove code ${promoCode}`} className="p-1 -m-1 rounded-lg hover:bg-black/5 cursor-pointer shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    {!promoCode && promo && !promo.ok && (
                      <p role="alert" className="text-[11px] text-red-600 dark:text-red-400 px-1">
                        {promo.reason}{promo.hint ? ` ${promo.hint}` : ''}
                      </p>
                    )}
                  </div>
                )}

                {/* Pricing Summary */}
                <div className="bg-app-bg border border-app-border rounded-2xl p-3 text-xs flex flex-col gap-1.5">
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">
                      Subtotal
                    </span>
                    <span className="text-app-text font-bold font-mono">
                      {formatCurrency(totalOriginal)}
                    </span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-amber-500 font-semibold">
                        Discount
                      </span>
                      <span className="text-amber-500 font-bold font-mono">
                        -{formatCurrency(totalDiscount)}
                      </span>
                    </div>
                  )}
                  {promoDiscount > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                        {promo?.referral ? 'Referral' : 'Promotion'} {promoCode}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono shrink-0">
                        -{formatCurrency(promoDiscount)}
                      </span>
                    </div>
                  )}
                  {pointsDiscount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        Paid with {pointsNum} points
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono">
                        -{formatCurrency(pointsDiscount)}
                      </span>
                    </div>
                  )}
                  {tax > 0 && (
                    <div className="flex justify-between">
                    <span className="text-app-text-muted">
                      VAT ({(taxRate * 100).toFixed(0)}%)
                    </span>
                    <span className="text-app-text font-bold font-mono">
                      {formatCurrency(tax)}
                    </span>
                  </div>
                  )}
                  {isDelivery && deliveryFee > 0 && (customerPaysDelivery ? (
                    <div className="flex justify-between">
                      <span className="text-blue-500 font-semibold">
                        Delivery
                      </span>
                      <span className="text-blue-500 font-bold font-mono">
                        {formatCurrency(deliveryFee)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between gap-2">
                      <span className="text-app-text-muted">
                        {deliveryMode === 'free'
                          ? `Delivery: free (we pay the rider ${formatCurrency(deliveryFee)})`
                          : `Delivery: customer pays the rider ${formatCurrency(deliveryFee)} in cash`}
                      </span>
                      <span className="text-app-text-muted font-mono shrink-0">not on bill</span>
                    </div>
                  ))}
                  <div className="h-[1px] bg-app-border my-1" />
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-app-text">Final Total</span>
                    <span className="text-amber-500 font-mono text-sm">
                      {formatCurrency(finalTotal)}
                    </span>
                  </div>
                </div>

                {/* Security Error message block */}
                {checkoutError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs text-red-500 font-bold leading-tight flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0" />
                    <span>{checkoutError}</span>
                  </div>
                )}
              </div>

              {/* Drawer Footer Buttons using theme classes */}
              <div className="p-4 pb-[calc(1rem+var(--inset-bottom))] border-t border-app-border bg-app-bg/40 flex items-center justify-between gap-3 shrink-0">
                {!isWide && (
                  <button
                    onClick={() => setIsCartOpen(false)}
                    className="px-4 py-3.5 rounded-xl border border-app-border text-sm font-bold text-app-text hover:bg-app-bg transition shrink-0 cursor-pointer"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => void handleCheckout()}
                  disabled={isCheckingOut || cart.length === 0}
                  title="Complete sale (F9 or Ctrl+Enter)"
                  className={`flex-1 ${isWide ? 'py-2.5 text-xs' : 'py-3.5 text-sm'} bg-amber-500 text-slate-950 font-semibold rounded-xl hover:bg-amber-600 disabled:opacity-55 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 cursor-pointer`}
                >
                  {isCheckingOut ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <span className="flex items-center gap-2">
                      {paymentMethod === 'Card' && !paidCard ? 'Charge card' : needsPaymentCode(paymentMethod) && !paymentRef.trim() ? 'Enter the code to finish' : 'Complete sale'} · {formatCurrency(finalTotal)}
                      {isWide && <kbd className="px-1.5 py-0.5 rounded bg-slate-950/15 text-[10px] font-mono">F9</kbd>}
                    </span>
                  )}
                </button>
              </div>
    </>
  );

  return (
    <div className="flex-1 flex h-full bg-app-bg relative overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col h-full">
      {/* Search & Category Filter */}
      <div className="bg-app-card border-b border-app-border p-3 flex flex-col gap-2.5 shrink-0 shadow-xs">
        <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            size={15}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-app-text-muted"
          />
          <input
            ref={searchRef}
            type="search"
            enterKeyHint="go"
            placeholder={isWide ? 'Search products, Enter adds   ( / )' : 'Search products by name or SKU...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-app-bg text-xs lg:text-sm pl-9 pr-4 py-2 lg:py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:bg-app-bg text-app-text transition"
          />
        </div>
        {isWide && (
          <button
            // The same help as every screen, from the one list of shortcuts.
            onClick={() => window.dispatchEvent(new Event('app:shortcut-help'))}
            data-shortcut="help"
            title="Keyboard shortcuts (? or F1)"
            className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-app-bg text-app-text-muted hover:text-app-text text-xs font-medium cursor-pointer"
          >
            <Keyboard size={15} /> Shortcuts
          </button>
        )}
        </div>

        {/* Horizontal Category Pill Scrollbar */}
        <div className="flex gap-2 overflow-x-auto pb-1 select-none scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer capitalize ${
                activeCategory === cat
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-app-bg text-app-text border border-app-border/70 hover:bg-app-card'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Products Grid */}
      <div className={`flex-1 overflow-y-auto p-2.5 lg:p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2.5 lg:gap-3 content-start ${cart.length > 0 && !isWide ? 'pb-[calc(var(--mobile-nav-space)+5.5rem)]' : 'pb-nav'} lg:pb-6`}>
        {filteredProducts.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            index={index}
            highlighted={index === highlight}
            cartQty={cartQtyById.get(product.id) || 0}
            onAdd={addToCart}
          />
        ))}
      </div>

      </div>

      {/* Big screens: the cart stays open beside the products */}
      {isWide && (
        <aside className="w-[380px] xl:w-[420px] shrink-0 h-full flex flex-col bg-app-card border-l border-app-border pt-3" aria-label="Cart">
          {cartPanel}
        </aside>
      )}

      {/* Phones: one full-width checkout bar above the nav, thumb-sized */}
      {cart.length > 0 && !isWide && (
        <div className="absolute left-0 right-0 bottom-(--mobile-nav-space) md:bottom-4 px-3 z-40">
          <button
            type="button"
            onClick={() => {
              setCheckoutError(null);
              setIsCartOpen(true);
            }}
            className="w-full min-h-14 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-slate-950 shadow-xl transition cursor-pointer"
            aria-label={`Checkout, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}, ${formatCurrency(finalTotal)}`}
          >
            <span className="relative shrink-0 p-2 rounded-xl bg-slate-950/10">
              <ShoppingCart size={18} aria-hidden="true" />
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-slate-950 text-amber-400 text-[11px] font-semibold flex items-center justify-center">
                {cartCount}
              </span>
            </span>
            <span className="flex-1 text-left">
              <span className="block text-[11px] font-medium opacity-80 leading-tight">{paymentMethod}</span>
              <span className="block font-mono text-base font-bold leading-tight">{formatCurrency(finalTotal)}</span>
            </span>
            <span className="shrink-0 text-sm font-bold">Checkout</span>
          </button>
        </div>
      )}

      {/* POS Cart / Checkout Bottom Sheet Drawer */}
      <SheetLayer>
      <AnimatePresence>
        {isCartOpen && !isWide && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCartOpen(false)}
              className="absolute inset-0 bg-black z-40"
            />

            {/* Bottom Sheet Drawer using theme colors */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 max-h-[92dvh] bg-app-card rounded-t-3xl border-t border-app-border shadow-2xl flex flex-col z-50 overflow-hidden"
            >
              {/* Drag handle decoration */}
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto my-3 shrink-0" />

              {cartPanel}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </SheetLayer>


      {/* Success Modal Drawer using theme classes */}
      <SheetLayer>
      <AnimatePresence>
        {checkoutSuccess && (
          <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-app-card p-6 rounded-3xl max-w-sm w-full border border-app-border text-center shadow-2xl flex flex-col items-center"
            >
              <div className="p-3.5 bg-emerald-500/15 text-emerald-500 rounded-full mb-3.5">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-sm font-semibold font-display text-app-text">
                Sale saved
              </h3>
              <p className="text-[11px] text-app-text-muted mt-1 max-w-xs leading-relaxed font-medium">
                <span className="text-emerald-500 font-bold">
                  {isOnline ? 'Saved online.' : 'Saved on this device. It goes online when the internet is back.'}
                </span>
              </p>

              <div className="w-full bg-app-bg border border-app-border rounded-2xl p-3 my-4 text-[10.5px] text-left font-mono space-y-0.5">
                <span className="text-app-text-muted block">
                  RECEIPT NO: {formatReceiptNumber(lastTxId)}
                </span>
                <span className="text-app-text-muted block">
                  DATE: {new Date().toLocaleDateString()}
                </span>
                <span className="text-app-text block font-bold text-amber-500 text-xs border-t border-app-border/40 pt-1 mt-1.5">
                  Total: {formatCurrency(lastTx?.finalTotal ?? finalTotal)}
                </span>
              </div>

              {lastTx?.paymentRef && (
                <p className="text-[11px] text-app-text-muted mb-2">Paid with code {lastTx.paymentRef}</p>
              )}
              <div className="w-full flex gap-2">
                <button
                  onClick={() => {
                    setCheckoutSuccess(false);
                    setReceiptAutoPrint(false);
                    setReceiptTx(lastTx);
                  }}
                  disabled={!lastTx}
                  className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <ReceiptText size={14} /> Receipt
                  <kbd className="hidden md:inline px-1 rounded border border-current/30 text-[10px] font-mono opacity-70">R</kbd>
                </button>
                <button
                  onClick={() => setCheckoutSuccess(false)}
                  className="flex-1 py-2 bg-app-text text-app-bg font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </SheetLayer>
      <CardChargeSheet
        open={cardSheetOpen}
        amount={Math.round(finalTotal * 100) / 100}
        purpose="sale"
        customer={selectedCustomer}
        description={`Sale of ${cart.length} ${cart.length === 1 ? 'item' : 'items'}`}
        onPaid={(result) => {
          setCardSheetOpen(false);
          setPaidCard(result);
          void handleCheckout(result);
        }}
        onClose={() => setCardSheetOpen(false)}
      />
      {quoting && <QuoteFromCartSheet deliveryFee={customerPaysDelivery ? deliveryFee : 0} onClose={() => setQuoting(false)} />}
      <ReceiptSheet
        transaction={receiptTx}
        startPrinting={receiptAutoPrint}
        onClose={() => {
          setReceiptTx(null);
          setReceiptAutoPrint(false);
        }}
      />
    </div>
  );
}

// One product on the till. Memoised: adding to the cart redraws only the card whose count
// changed, not the whole grid.
const ProductCard = memo(function ProductCard({
  product,
  index,
  highlighted,
  cartQty,
  onAdd,
}: {
  product: Product;
  index: number;
  highlighted: boolean;
  cartQty: number;
  onAdd: (product: Product) => void;
}) {
  const isLowStock = product.stock <= product.minStock;
  const isOutOfStock = product.stock === 0;
  return (
    <div
      id={`pos-product-${index}`}
      data-search-id={`prod-${product.id}`}
      onClick={() => !isOutOfStock && onAdd(product)}
      className={`bg-app-card rounded-2xl border transition-transform ${!isOutOfStock ? 'active:scale-[0.98]' : ''} [content-visibility:auto] [contain-intrinsic-size:auto_220px] ${
        highlighted
          ? 'border-sky-500 ring-2 ring-sky-500/50'
          : cartQty > 0
          ? 'border-amber-500 ring-1 ring-amber-500/50'
          : 'border-app-border'
      } overflow-hidden shadow-xs cursor-pointer select-none relative flex flex-col min-h-[220px] h-fit`}
    >
      <div className="w-full h-24 bg-app-bg relative shrink-0">
        <img
          loading="lazy"
          decoding="async"
          src={product.image || 'https://images.unsplash.com/photo-1561715276-a2d087060f1d?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8c2hvcHBpbmclMjBiYWd8ZW58MHx8MHx8fDA%3D'}
          alt={product.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        {isOutOfStock ? (
          <div className="absolute inset-0 bg-black/75 flex items-center justify-center text-red-400 font-semibold text-[10px]">
            Out of Stock
          </div>
        ) : isLowStock ? (
          <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-red-500 text-white rounded text-[11px] font-semibold shadow">
            Low Stock
          </div>
        ) : null}

        {cartQty > 0 && (
          <div className="absolute top-2 right-2 w-5.5 h-5.5 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center font-semibold text-[11px] shadow">
            {cartQty}
          </div>
        )}
      </div>

      <div className="p-2 flex-1 flex flex-col justify-between gap-1.5">
        <div>
          <span className="text-[11px] font-mono font-bold text-app-text-muted block">
            {titleCase(product.unit)} · {product.sku}
          </span>
          <h3 className="text-[11px] font-bold font-display text-app-text mt-0.5 line-clamp-2 leading-tight">
            {titleCase(product.name)}
          </h3>
        </div>
        <div className="text-[11px] text-app-text-muted leading-tight">
          {product.description?.trim() ? (
            sentenceCase(product.description)
          ) : (
            <span className="italic text-app-text-muted/70">
              No description provided
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mt-1 gap-1">
          <span className="text-xs font-semibold text-amber-500 whitespace-nowrap">
            {formatCurrency(product.price)}
          </span>
          <span
            className={`text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
              isOutOfStock
                ? 'bg-red-500/10 text-red-500'
                : isLowStock
                ? 'bg-amber-500/10 text-amber-500'
                : 'bg-emerald-500/10 text-emerald-500'
            }`}
          >
            {product.stock} left
          </span>
        </div>
      </div>
    </div>
  );
});

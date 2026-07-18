import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { Product, ProductCategory, PaymentMethod } from '../types';
import {
  ShoppingCart,
  Search,
  User,
  Trash2,
  Tag,
  Percent,
  ArrowLeft,
  CheckCircle2,
  Truck,
  RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SearchableDropdown from '../components/SearchableDropdown';
import { titleCase, sentenceCase, searchMatch } from '../utils/stringUtils';
import { formatReceiptNumber } from '../utils/idUtils';

export default function POSView() {
  const {
    products,
    cart,
    selectedCustomer,
    customers,
    addToCart,
    removeFromCart,
    categories: productCategories,
    updateCartQty,
    updateCartDiscount,
    selectCustomer,
    checkout,
    clearCart,
    isOnline,
    employees,
    showToast,
    businesses,
    activeBusinessId,
  } = useAppStore();

  const [activeCategory, setActiveCategory] = useState<ProductCategory | 'All'>(
    'All',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [note, setNote] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [lastTxId, setLastTxId] = useState('');
  const activeBusiness = businesses.find((b) => b.id === activeBusinessId);
  const businessTaxRate = activeBusiness?.isTaxEnabled ? (typeof activeBusiness.taxPercentage === 'number' ? activeBusiness.taxPercentage / 100 : 0.16) : 0.0;
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
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [riderName, setRiderName] = useState('');
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const riders = employees.filter((emp) => emp.role === 'Staff');

  const categories: (ProductCategory | 'All')[] = ['All', ...productCategories];

  const filteredProducts = products.filter((p) => {
    const matchesCategory =
      activeCategory === 'All' || p.category === activeCategory;
    const matchesSearch =
      searchMatch(p.name, searchQuery) || searchMatch(p.sku, searchQuery);
    return matchesCategory && matchesSearch;
  });

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  // Calculate Totals
  let totalOriginal = 0;
  let totalItemDiscount = 0;
  cart.forEach((item) => {
    const itemTotal = item.product.price * item.quantity;
    totalOriginal += itemTotal;
    totalItemDiscount += itemTotal * (item.discountPercentage / 100);
  });

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
  cartDiscount = Math.min(cartDiscount, subtotalBeforeCartDiscount);

  const subtotal = subtotalBeforeCartDiscount - cartDiscount;
  const totalDiscount = totalItemDiscount + cartDiscount;
  const tax = subtotal * taxRate;
  const finalTotal = subtotal + tax + (isDelivery ? deliveryFee : 0);

  const handleCheckout = async () => {
    if (isCheckingOut) return;
    setIsCheckingOut(true);
    setCheckoutError(null);
    try {
      const result = await checkout(
        paymentMethod,
        note,
        taxRate,
        cartDiscountType,
        cartDiscountValue,
        isDelivery,
        deliveryFee,
        isDelivery ? riderName : '',
      );
      if (result.success && result.transaction) {
        setLastTxId(result.transaction.id);
        setCheckoutSuccess(true);
        setIsCartOpen(false);
        setNote('');
        setCartDiscountValue(0);
        setTaxRate(businessTaxRate);
        setIsDelivery(false);
        setDeliveryFee(0);
        setRiderName('');
        setSelectedRiderId('');

        // Send a professional toast popup notification on completed checkout action
        showToast(
          'Order Processed',
          `Sale of KSh ${finalTotal.toFixed(
            0,
          )} successfully logged via ${paymentMethod.replace('_', ' ')}.`,
          undefined,
          'success',
        );
      } else if (result.error) {
        setCheckoutError(result.error);
      }
    } catch (err: any) {
      setCheckoutError(err.message || 'Checkout failed due to an error.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg relative overflow-hidden">
      {/* Search & Category Filter */}
      <div className="bg-app-card border-b border-app-border p-3 flex flex-col gap-2.5 shrink-0 shadow-xs">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-app-text-muted"
          />
          <input
            type="text"
            placeholder="Search products by name or SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-app-bg text-xs pl-9 pr-4 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:bg-app-bg text-app-text transition"
          />
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
      <div className="flex-1 overflow-y-auto p-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 pb-24">
        {filteredProducts.map((product) => {
          const isLowStock = product.stock <= product.minStock;
          const isOutOfStock = product.stock === 0;
          const cartItem = cart.find((item) => item.product.id === product.id);
          const cartQty = cartItem?.quantity || 0;

          return (
            <motion.div
              key={product.id}
              whileTap={!isOutOfStock ? { scale: 0.98 } : {}}
              onClick={() => !isOutOfStock && addToCart(product)}
              className={`bg-app-card rounded-2xl border ${
                cartQty > 0
                  ? 'border-amber-500 ring-1 ring-amber-500/50'
                  : 'border-app-border'
              } overflow-hidden shadow-xs cursor-pointer select-none relative flex flex-col min-h-[220px] h-fit`}
            >
              <div className="w-full h-24 bg-app-bg relative shrink-0">
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                {isOutOfStock ? (
                  <div className="absolute inset-0 bg-black/75 flex items-center justify-center text-red-400 font-extrabold text-[10px] uppercase tracking-wider">
                    Out of Stock
                  </div>
                ) : isLowStock ? (
                  <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-red-500 text-white rounded text-[8px] font-black uppercase tracking-wider shadow">
                    Low Stock
                  </div>
                ) : null}

                {cartQty > 0 && (
                  <div className="absolute top-2 right-2 w-5.5 h-5.5 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center font-black text-[11px] shadow">
                    {cartQty}
                  </div>
                )}
              </div>

              <div className="p-2 flex-1 flex flex-col justify-between gap-1.5">
                <div>
                  <span className="text-[9px] font-mono font-bold text-app-text-muted block">
                    {titleCase(product.unit)} · {product.sku}
                  </span>
                  <h3 className="text-[11px] font-bold font-display text-app-text mt-0.5 line-clamp-2 leading-tight">
                    {titleCase(product.name)}
                  </h3>
                </div>
                <div className="text-[8.5px] text-app-text-muted leading-tight">
                  {product.description?.trim() ? (
                    sentenceCase(product.description)
                  ) : (
                    <span className="italic text-app-text-muted/70">
                      No description provided
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-1 gap-1">
                  <span className="text-xs font-black text-amber-500 whitespace-nowrap">
                    KSh {Math.round(product.price)}
                  </span>
                  <span
                    className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
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
            </motion.div>
          );
        })}
      </div>

      {/* Draggable Bottom Floating POS Bar (Compact & Drag Allowed to Shop Unimpeded) */}
      {cart.length > 0 && (
        <motion.div
          drag
          dragConstraints={{ left: -300, right: 10, top: -600, bottom: 10 }}
          dragElastic={0.08}
          dragMomentum={false}
          className="absolute bottom-20 right-4 bg-app-card text-app-text p-2 rounded-xl shadow-2xl flex items-center gap-2.5 border border-amber-500/30 z-40 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2.5 select-none pointer-events-none">
            <div className="relative p-1.5 bg-amber-500 text-slate-950 rounded-lg shrink-0">
              <ShoppingCart size={11} />
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[7.5px] font-black px-1 rounded-full shadow-sm">
                {cartCount}
              </span>
            </div>
            <div>
              <span className="text-[7px] text-app-text-muted block font-black leading-none uppercase">
                Total
              </span>
              <span className="font-mono text-[10.5px] font-black text-amber-500 leading-none">
                KSh {finalTotal.toFixed(0)}
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              setCheckoutError(null);
              setIsCartOpen(true);
            }}
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg text-[9px] uppercase transition cursor-pointer shrink-0"
          >
            Review
          </button>
        </motion.div>
      )}

      {/* POS Cart / Checkout Bottom Sheet Drawer */}
      <AnimatePresence>
        {isCartOpen && (
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
              className="absolute bottom-0 left-0 right-0 max-h-[90%] bg-app-card rounded-t-[32px] border-t border-app-border shadow-2xl flex flex-col z-50 overflow-hidden"
            >
              {/* Drag handle decoration */}
              <div className="w-12 h-1 bg-app-border rounded-full mx-auto my-3 shrink-0" />

              {/* Drawer Header */}
              <div className="px-5 pb-3 border-b border-app-border flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-sm font-black font-display text-app-text uppercase tracking-wide">
                    POS Shopping Cart
                  </h2>
                  <span className="text-[10px] text-app-text-muted font-medium">
                    16% VAT Configured
                  </span>
                </div>
                <button
                  onClick={clearCart}
                  className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition cursor-pointer"
                  title="Clear Cart"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {/* Drawer Body - Scrollable Items List */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {/* Cart Items Checklist with themed cards */}
                <div className="flex flex-col gap-2">
                  {cart.map((item) => {
                    const lineTotalOriginal =
                      item.product.price * item.quantity;
                    const lineTotalDisc =
                      lineTotalOriginal * (item.discountPercentage / 100);

                    return (
                      <div
                        key={item.product.id}
                        className="p-3 bg-app-bg rounded-2xl border border-app-border flex items-center justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-app-text truncate">
                            {titleCase(item.product.name)}
                          </h4>
                          <span className="text-[10px] text-app-text-muted block mt-0.5">
                            KSh {item.product.price.toFixed(0)} each ·{' '}
                            {item.product.sku}
                          </span>
                        </div>

                        {/* Adjust qty & Discount */}
                        <div className="flex items-center gap-3">
                          {/* Qty Counter using theme styles */}
                          <div className="flex items-center bg-app-card rounded-lg p-1 border border-app-border">
                            <button
                              onClick={() => {
                                if (item.quantity === 1)
                                  removeFromCart(item.product.id);
                                else
                                  updateCartQty(
                                    item.product.id,
                                    item.quantity - 1,
                                  );
                              }}
                              className="w-6 h-6 flex items-center justify-center font-bold text-app-text hover:bg-app-bg rounded transition cursor-pointer"
                            >
                              -
                            </button>
                            <span className="w-8 text-center text-xs font-bold text-app-text">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() =>
                                updateCartQty(
                                  item.product.id,
                                  item.quantity + 1,
                                )
                              }
                              className="w-6 h-6 flex items-center justify-center font-bold text-app-text hover:bg-app-bg rounded transition cursor-pointer"
                            >
                              +
                            </button>
                          </div>

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
                      </div>
                    );
                  })}
                </div>

                {/* Assign Customer Profile with themed container */}
                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-bold text-app-text">
                    <span className="flex items-center gap-1.5 text-amber-500">
                      <User size={13} />
                      <span>Loyalty Customer</span>
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
                        </span>{' '}
                        · Loyalty Points: {selectedCustomer.loyaltyPoints} ·
                        Current Debt:{' '}
                        <span className="text-red-400 font-bold">
                          KSh {(selectedCustomer.debtBalance || 0).toFixed(2)}
                        </span>
                      </p>
                    </div>
                  ) : (
                    <SearchableDropdown
                      items={customers.map((cust) => ({
                        id: cust.id,
                        label: cust.name,
                        sublabel: `${cust.phone} · Tier: ${
                          cust.tier
                        } · Debt: KSh ${(cust.debtBalance || 0).toFixed(0)}`,
                      }))}
                      selectedValue=""
                      onChange={(val) => {
                        const matched = customers.find((c) => c.id === val);
                        if (matched) selectCustomer(matched);
                      }}
                      placeholder="Select a customer loyalty profile..."
                      searchPlaceholder="Search customer name or phone..."
                    />
                  )}
                </div>

                {/* Tx Note & Payment Settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-app-text-muted uppercase">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-3 gap-1 bg-app-bg p-1 rounded-xl border border-app-border">
                      {(
                        [
                          { value: 'Cash', label: 'Cash' },
                          { value: 'M-Pesa', label: 'M-Pesa' },
                          { value: 'Credit_Debt', label: 'Credit (Debt)' },
                        ] as const
                      ).map((method) => (
                        <button
                          key={method.value}
                          onClick={() => setPaymentMethod(method.value)}
                          className={`py-1.5 rounded-lg text-[9px] font-black uppercase transition cursor-pointer ${
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

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-app-text-muted uppercase">
                      Transaction Notes
                    </label>
                    <input
                      type="text"
                      placeholder="Add delivery instructions or note..."
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="bg-app-bg border border-app-border rounded-xl px-3 py-1.5 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>

                {/* Delivery Settings */}
                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-amber-500 text-xs font-bold">
                      <Truck size={13} />
                      <span>Set as Delivery Order</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={isDelivery}
                      onChange={(e) => {
                        setIsDelivery(e.target.checked);
                        if (!e.target.checked) {
                          setDeliveryFee(0);
                          setRiderName('');
                          setSelectedRiderId('');
                        }
                      }}
                      className="w-4 h-4 text-amber-500 bg-app-bg border-app-border rounded focus:ring-amber-500 accent-amber-500 cursor-pointer"
                    />
                  </div>

                  {isDelivery && (
                    <div className="space-y-3 pt-2 border-t border-app-border/40 animate-fade-in">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">
                            Delivery Fee (KSh)
                          </label>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={deliveryFee || ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setDeliveryFee(isNaN(val) ? 0 : val);
                            }}
                            className="bg-app-bg border border-app-border rounded-xl px-3 py-1.5 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono text-right"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase">
                            Fee Shortcuts
                          </label>
                          <div className="grid grid-cols-3 gap-1 bg-app-bg p-1 rounded-xl border border-app-border h-full">
                            {[0, 150, 250].map((fee) => (
                              <button
                                key={fee}
                                type="button"
                                onClick={() => setDeliveryFee(fee)}
                                className={`py-1 rounded-lg text-[9px] font-black uppercase transition cursor-pointer ${
                                  deliveryFee === fee
                                    ? 'bg-amber-500 text-slate-950 shadow'
                                    : 'text-app-text-muted hover:bg-app-bg'
                                }`}
                              >
                                KSh {fee}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase">
                          Select Rider or Write Name
                        </label>
                        <div className="space-y-2">
                          <SearchableDropdown
                            items={[
                              {
                                id: 'custom_name',
                                label: 'Write a Custom Name...',
                              },
                              ...riders.map((r) => ({
                                id: r.name,
                                label: r.name,
                                sublabel: `Active Rider · Phone: ${r.phone}`,
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
                            placeholder="Choose an active Rider..."
                            searchPlaceholder="Search active riders..."
                          />

                          {(selectedRiderId === 'custom_name' ||
                            !riders.some(
                              (r) => r.name === selectedRiderId,
                            )) && (
                            <input
                              type="text"
                              placeholder="Enter Rider's Name manually..."
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

                {/* Additional Checkout Controls: Tax & Discount */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-app-bg/50 border border-app-border/60 rounded-2xl">
                  {/* Tax Rate Setting */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-app-text-muted uppercase">
                      Tax Configuration
                    </label>
                    <div className="grid grid-cols-2 gap-1 bg-app-bg p-1 rounded-xl border border-app-border">
                      <button
                        type="button"
                        onClick={() => setTaxRate(businessTaxRate)}
                        className={`py-1 rounded-lg text-[9px] font-black uppercase transition cursor-pointer ${
                          taxRate === businessTaxRate
                            ? 'bg-amber-500 text-slate-950 shadow'
                            : 'text-app-text-muted hover:bg-app-bg'
                        }`}
                      >
                        {(businessTaxRate * 100).toFixed(0)}% VAT Business Default
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaxRate(0.0)}
                        className={`py-1 rounded-lg text-[9px] font-black uppercase transition cursor-pointer ${
                          taxRate === 0.0
                            ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-bold shadow-xs'
                            : 'text-app-text-muted hover:bg-app-bg'
                        }`}
                      >
                        Tax Free (0% VAT)
                      </button>
                    </div>
                  </div>

                  {/* Checkout Discount Setting */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-app-text-muted uppercase">
                      Checkout Waiver / Discount
                    </label>
                    <div className="flex gap-1.5">
                      <div className="flex bg-app-bg p-1 rounded-xl border border-app-border shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setCartDiscountType('percent');
                            setCartDiscountValue(0);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition cursor-pointer ${
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
                          className={`px-2 py-1 rounded-lg text-[9px] font-black transition cursor-pointer ${
                            cartDiscountType === 'amount'
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-app-text-muted'
                          }`}
                        >
                          KSh
                        </button>
                      </div>
                      <input
                        type="number"
                        min="0"
                        placeholder={
                          cartDiscountType === 'percent'
                            ? 'E.g. 10 for 10%'
                            : 'E.g. 150 for KSh 150'
                        }
                        value={cartDiscountValue || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setCartDiscountValue(isNaN(val) ? 0 : val);
                        }}
                        className="flex-1 bg-app-bg border border-app-border rounded-xl px-3 py-1 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500 text-right font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Pricing Summary */}
                <div className="bg-app-bg border border-app-border rounded-2xl p-3 text-xs flex flex-col gap-1.5">
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">
                      Subtotal Original
                    </span>
                    <span className="text-app-text font-bold font-mono">
                      KSh {totalOriginal.toFixed(2)}
                    </span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-amber-500 font-semibold">
                        Waiver Discounts
                      </span>
                      <span className="text-amber-500 font-bold font-mono">
                        -KSh {totalDiscount.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">
                      Kenyan VAT (16%)
                    </span>
                    <span className="text-app-text font-bold font-mono">
                      KSh {tax.toFixed(2)}
                    </span>
                  </div>
                  {isDelivery && deliveryFee > 0 && (
                    <div className="flex justify-between">
                      <span className="text-blue-500 font-semibold">
                        Delivery Fee
                      </span>
                      <span className="text-blue-500 font-bold font-mono">
                        KSh {deliveryFee.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="h-[1px] bg-app-border my-1" />
                  <div className="flex justify-between text-xs font-black">
                    <span className="text-app-text">Final Total</span>
                    <span className="text-amber-500 font-mono text-sm">
                      KSh {finalTotal.toFixed(2)}
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
              <div className="p-4 border-t border-app-border bg-app-bg/40 flex items-center justify-between gap-3 shrink-0">
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-app-border text-xs font-bold text-app-text hover:bg-app-bg transition shrink-0 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCheckout}
                  disabled={isCheckingOut}
                  className="flex-1 py-2.5 bg-amber-500 text-slate-950 font-black rounded-xl text-xs hover:bg-amber-600 disabled:opacity-55 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isCheckingOut ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Processing Sale...</span>
                    </>
                  ) : (
                    <span>
                      Complete & Sync Sale (KSh {finalTotal.toFixed(0)})
                    </span>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Success Modal Drawer using theme classes */}
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
              <h3 className="text-sm font-extrabold font-display text-app-text uppercase tracking-wide">
                Transaction Recorded!
              </h3>
              <p className="text-[11px] text-app-text-muted mt-1 max-w-xs leading-relaxed font-medium">
                The order was logged successfully. Sync status:{' '}
                <span className="text-emerald-500 font-bold">
                  {isOnline ? 'Cloud Synced' : 'Offline Queued'}
                </span>
                .
              </p>

              <div className="w-full bg-app-bg border border-app-border rounded-2xl p-3 my-4 text-[10.5px] text-left font-mono space-y-0.5">
                <span className="text-app-text-muted block">
                  RECEIPT NO: {formatReceiptNumber(lastTxId)}
                </span>
                <span className="text-app-text-muted block">
                  DATE: {new Date().toLocaleDateString()}
                </span>
                <span className="text-app-text block font-bold text-amber-500 text-xs border-t border-app-border/40 pt-1 mt-1.5">
                  Total: KSh {finalTotal.toFixed(2)}
                </span>
              </div>

              <button
                onClick={() => setCheckoutSuccess(false)}
                className="w-full py-2 bg-app-text text-app-bg font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

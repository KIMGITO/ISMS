import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Gift, Lock, MapPin, Minus, Plus, ShoppingBag, Tag, Trash2, Truck, X } from 'lucide-react';
import { checkPromoCode, CartLine, fetchRewards, friendlyError, placeOrder, Product, PromoCheck, Rewards } from '../api';
import { navigate } from '../router';
import { productPaths } from '../seo';
import { useAuth, useCart, usePromo, useStorefront } from '../store';
import { cardClass, ErrorText, fieldClass, formatPrice, Notice, pageClass, perUnit, primaryButton, ProductImage, promotionLabel, TrustStrip } from '../ui';
import { AuthForms, FinishAccountForm } from './AuthForms';

/** Where to send the shopper after a sign-in that leaves the page (Google returns to /account). */
export const RETURN_KEY = 'kaykays-return-to';

type Row = { line: CartLine; product: Product };

function useCartRows(): Row[] {
  const { products } = useStorefront();
  const lines = useCart((s) => s.lines);
  return lines
    .map((line) => ({ line, product: products.find((p) => p.id === line.productId) }))
    .filter((row): row is Row => Boolean(row.product));
}

const subtotalOf = (rows: Row[]) => rows.reduce((sum, { line, product }) => sum + product.price * line.quantity, 0);

/** Cart, then sign-in and details, then M-Pesa payment on the order page. */
export function CheckoutSteps({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = [
    { label: 'Cart', href: '/cart' },
    { label: 'Checkout', href: '/checkout' },
    { label: 'Pay with M-Pesa' },
    { label: 'Confirmed' },
  ];
  return (
    <ol className="flex items-center gap-2 text-sm font-medium sm:gap-3" aria-label="Checkout steps">
      {steps.map(({ label, href }, index) => {
        const number = index + 1;
        const state = number < step ? 'done' : number === step ? 'current' : 'next';
        const content = (
          <>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${state === 'next' ? 'border border-line text-muted' : 'bg-ink text-cream'}`}>
              {state === 'done' ? <CheckCircle2 size={15} aria-hidden /> : number}
            </span>
            <span className={`truncate ${state === 'next' ? 'text-muted' : ''} ${state === 'current' ? '' : 'hidden md:inline'}`}>{label}</span>
          </>
        );
        return (
          <li key={label} className="flex min-w-0 items-center gap-2 sm:gap-3" aria-current={state === 'current' ? 'step' : undefined}>
            {index > 0 && <span className={`h-px w-4 shrink-0 sm:w-8 ${state === 'next' ? 'bg-line' : 'bg-ink'}`} aria-hidden />}
            {state === 'done' && href && step < 3
              ? <a href={href} className="flex items-center gap-2 hover:underline">{content}</a>
              : <span className="flex items-center gap-2">{content}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Checks the cart's promo code against today's subtotal. The server checks again when the order is placed. */
function usePromoCheck(subtotal: number) {
  const code = usePromo((s) => s.code);
  const [result, setResult] = useState<PromoCheck | null>(null);
  const [error, setError] = useState('');
  const session = useAuth((s) => s.session);
  useEffect(() => {
    if (!code) {
      setResult(null);
      setError('');
      return;
    }
    let live = true;
    checkPromoCode(code, subtotal)
      .then((r) => { if (live) { setResult(r); setError(''); } })
      .catch((err) => { if (live) { setResult(null); setError(friendlyError(err, "We couldn't check that code.")); } });
    return () => { live = false; };
  }, [code, subtotal, session]);
  return { code, result, error };
}

function PromoField({ subtotal }: { subtotal: number }) {
  const { currency } = useStorefront().business;
  const setCode = usePromo((s) => s.setCode);
  const { code, result, error } = usePromoCheck(subtotal);
  const [input, setInput] = useState('');

  if (code) {
    return (
      <div className={`rounded-lg p-3 text-sm ${result ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-semibold"><Tag size={15} aria-hidden /> {code}</span>
          <button type="button" onClick={() => setCode('')} aria-label="Remove promo code" className="-m-2 grid size-9 place-items-center"><X size={16} aria-hidden /></button>
        </div>
        <p className="mt-1">
          {result
            ? `${promotionLabel(result, currency)}: you save ${formatPrice(currency, result.saving)}.${result.description ? ` ${result.description}` : ''}`
            : error || 'Checking…'}
        </p>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (input.trim()) setCode(input.trim().toUpperCase()); }}
      className="flex gap-2"
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">Promo code</span>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Promo code" autoCapitalize="characters" className="field mt-0 uppercase placeholder:normal-case" />
      </label>
      <button type="submit" className="btn btn-secondary shrink-0 rounded-lg px-4">Apply</button>
    </form>
  );
}

function DeliveryEstimate() {
  const { settings, deliveryZones, business, branches } = useStorefront();
  const pickupAt = branches.find((b) => b.address)?.address ?? business.address;
  return (
    <div className="space-y-2 text-sm text-muted">
      {settings.deliveryEnabled && (
        <p className="flex gap-2">
          <Truck size={16} className="mt-0.5 shrink-0 text-ember" aria-hidden />
          {deliveryZones.length > 0
            ? `Delivery from ${formatPrice(business.currency, Math.min(...deliveryZones.map((z) => Number(z.fee))))} depending on your area (${deliveryZones.map((z) => z.name).slice(0, 4).join(', ')}${deliveryZones.length > 4 ? '…' : ''}).`
            : Number(settings.deliveryFee) > 0 ? `Delivery ${formatPrice(business.currency, settings.deliveryFee)}.` : 'Free delivery.'}
          {' '}<a href="/delivery" className="underline hover:text-ink">Details</a>
        </p>
      )}
      <p className="flex gap-2">
        <MapPin size={16} className="mt-0.5 shrink-0 text-ember" aria-hidden />
        Free pickup{pickupAt ? ` at ${pickupAt}` : ' from our shop'}.
      </p>
    </div>
  );
}

export default function CartPage() {
  const site = useStorefront();
  const { products, business, settings } = site;
  const { setQuantity, remove } = useCart();
  const rows = useCartRows();
  const paths = productPaths(products);
  const subtotal = subtotalOf(rows);
  const { result: promo } = usePromoCheck(subtotal);

  if (rows.length === 0) {
    return (
      <Notice title="Your cart is empty" body="Add something from our shop, or ask our assistant what we have today.">
        <a href="/shop" className={`${primaryButton} mt-6`}>Go to the shop</a>
      </Notice>
    );
  }

  const saving = promo?.saving ?? 0;
  const shortBy = Number(settings.minOrder) - subtotal;

  return (
    <div className={pageClass}>
      <CheckoutSteps step={1} />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="display-lg">Your Cart</h1>
        <a href="/shop" className="flex items-center gap-1.5 py-2 font-medium text-muted hover:text-ink"><ArrowLeft size={17} aria-hidden /> Continue shopping</a>
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <ul className="space-y-4">
          {rows.map(({ line, product }) => (
            <li key={product.id} className={`${cardClass} flex gap-3 p-3 sm:gap-4 sm:p-4`}>
              <a href={paths.get(product.id)} className="size-20 shrink-0 overflow-hidden rounded-lg sm:size-24">
                <ProductImage product={product} width={240} />
              </a>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-medium"><a href={paths.get(product.id)} className="hover:underline">{product.name}</a></h2>
                    <p className="text-sm text-muted">{formatPrice(business.currency, product.price)} / {perUnit(product.unit)}</p>
                    {!product.inStock && <p className="text-sm font-medium text-red-700">Out of stock. Remove it to order.</p>}
                  </div>
                  <button onClick={() => remove(product.id)} aria-label={`Remove ${product.name}`} className="grid size-11 shrink-0 place-items-center text-muted hover:text-red-700">
                    <Trash2 size={19} aria-hidden />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center rounded-full border border-line">
                    <button
                      aria-label={`Less ${product.name}`}
                      onClick={() => setQuantity(product.id, Math.max(0.5, line.quantity - (line.quantity > 1 ? 1 : 0.5)))}
                      className="grid size-11 place-items-center"
                    >
                      <Minus size={17} aria-hidden />
                    </button>
                    <label>
                      <span className="sr-only">Amount of {product.name} in {product.unit}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0.5"
                        max="1000"
                        step="0.5"
                        value={line.quantity}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (value > 0 && value <= 1000) setQuantity(product.id, value);
                        }}
                        className="h-11 w-14 bg-transparent text-center text-base font-semibold"
                      />
                    </label>
                    <button aria-label={`More ${product.name}`} onClick={() => setQuantity(product.id, line.quantity + 1)} className="grid size-11 place-items-center">
                      <Plus size={17} aria-hidden />
                    </button>
                  </div>
                  <p className="font-semibold">{formatPrice(business.currency, product.price * line.quantity)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className={`${cardClass} space-y-5 p-5 lg:sticky lg:top-36`} aria-label="Order summary">
          <h2 className="text-xl font-medium">Order summary</h2>
          <PromoField subtotal={subtotal} />
          <dl className="space-y-1.5 border-t border-line pt-4">
            <div className="flex justify-between gap-3"><dt className="text-muted">Products ({rows.length})</dt><dd>{formatPrice(business.currency, subtotal)}</dd></div>
            {saving > 0 && <div className="flex justify-between gap-3 text-emerald-800"><dt>Promo {promo?.code}</dt><dd>-{formatPrice(business.currency, saving)}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-muted">Delivery</dt><dd className="text-muted">At checkout</dd></div>
            <div className="flex justify-between gap-3 pt-1 text-xl font-semibold"><dt>Estimated total</dt><dd>{formatPrice(business.currency, Math.floor(subtotal - saving))}</dd></div>
          </dl>
          <DeliveryEstimate />
          {shortBy > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm">Add {formatPrice(business.currency, shortBy)} more to reach the minimum order of {formatPrice(business.currency, settings.minOrder)}.</p>}
          <button onClick={() => navigate('/checkout')} disabled={shortBy > 0 || rows.some((r) => !r.product.inStock)} className="btn btn-accent min-h-12 w-full">
            <Lock size={17} aria-hidden /> Checkout
          </button>
          <p className="text-center text-sm text-muted">Secure payment with M-Pesa on your phone</p>
        </aside>
      </div>
      <div className="mt-10"><TrustStrip site={site} compact /></div>
    </div>
  );
}

export function CheckoutPage() {
  const site = useStorefront();
  const { business, settings, deliveryZones } = site;
  const rows = useCartRows();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);
  const ready = useAuth((s) => s.ready);
  const session = useAuth((s) => s.session);
  const account = useAuth((s) => s.account);
  const setPromo = usePromo((s) => s.setCode);
  const subtotal = subtotalOf(rows);
  const { code: promoCode, result: promo, error: promoError } = usePromoCheck(subtotal);

  const [fulfilment, setFulfilment] = useState<'delivery' | 'pickup'>(settings.deliveryEnabled ? 'delivery' : 'pickup');
  const [address, setAddress] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [points, setPoints] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (account) fetchRewards().then(setRewards).catch(() => setRewards(null));
  }, [account]);

  useEffect(() => {
    if (account?.delivery_address) setAddress((current) => current || account.delivery_address!);
    if (account?.delivery_notes) setNotes((current) => current || account.delivery_notes!);
  }, [account]);

  // Google sign-in comes back to /account, which sends the shopper here again.
  useEffect(() => {
    if (ready && !session) {
      try { sessionStorage.setItem(RETURN_KEY, '/checkout'); } catch { /* they can come back from the cart */ }
    }
  }, [ready, session]);

  if (rows.length === 0) {
    return (
      <Notice title="Nothing to check out" body="Your cart is empty. Add something from our shop first.">
        <a href="/shop" className={`${primaryButton} mt-6`}>Go to the shop</a>
      </Notice>
    );
  }
  if (!ready) return null;
  if (!session) {
    return (
      <>
        <div className="site-gutter pt-6"><CheckoutSteps step={2} /></div>
        <p className="site-gutter mt-4 text-muted">Sign in or create a free account to finish your order. Your cart is saved.</p>
        <AuthForms />
      </>
    );
  }
  if (!account) return <FinishAccountForm />;

  const zone = deliveryZones.find((z) => z.id === zoneId);
  const fee = fulfilment !== 'delivery' ? 0 : Number(deliveryZones.length > 0 ? zone?.fee ?? 0 : settings.deliveryFee);
  const saving = promo?.saving ?? 0;
  // The same limits the server enforces (fn_build_online_order): from the minimum, up to the
  // balance, and always leaving at least 1 shilling to pay by M-Pesa.
  const beforePoints = subtotal + fee - saving;
  const maxPoints = rewards && rewards.pointValue > 0
    ? Math.max(0, Math.min(rewards.points, Math.floor((beforePoints - 1) / rewards.pointValue)))
    : 0;
  const canUsePoints = Boolean(rewards) && maxPoints >= (rewards?.minRedeem ?? Infinity);
  const typedPoints = Number(points) > 0 ? Math.floor(Number(points)) : 0;
  const pointsUsed = usePoints && canUsePoints ? Math.min(Math.max(typedPoints, rewards!.minRedeem), maxPoints) : 0;
  const pointsValue = rewards ? pointsUsed * rewards.pointValue : 0;
  // M-Pesa only takes whole shillings, so the server rounds the total down the same way.
  const total = Math.floor(subtotal + fee - pointsValue - saving);
  const belowMinimum = subtotal < settings.minOrder;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const orderId = await placeOrder(lines, fulfilment, address, notes, zoneId || null, pointsUsed, promo ? promoCode : null);
      clear();
      setPromo('');
      navigate(`/account/orders/${orderId}`);
    } catch (err) {
      setError(friendlyError(err, "We couldn't place your order. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={pageClass}>
      <CheckoutSteps step={2} />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="display-lg">Checkout</h1>
        <a href="/cart" className="flex items-center gap-1.5 py-2 font-medium text-muted hover:text-ink"><ArrowLeft size={17} aria-hidden /> Back to cart</a>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="space-y-6">
          <section className={`${cardClass} p-5`}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-medium">1. Your details</h2>
              <a href="/account/profile" className="text-sm font-medium underline">Change</a>
            </div>
            <p className="mt-2 font-medium">{account.name}</p>
            <p className="text-muted">M-Pesa {account.phone}{account.email ? ` · ${account.email}` : ''}</p>
          </section>

          <section className={`${cardClass} space-y-4 p-5`}>
            <h2 className="text-lg font-medium">2. Delivery or pickup</h2>
            <fieldset>
              <legend className="sr-only">How would you like to receive it?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['delivery', 'pickup'] as const).map((option) => {
                  const disabled = option === 'delivery' && !settings.deliveryEnabled;
                  return (
                    <label
                      key={option}
                      className={`flex min-h-16 items-center gap-3 rounded-xl border px-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ember ${
                        fulfilment === option ? 'border-ink bg-amber-50' : 'border-line'
                      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    >
                      <input type="radio" name="fulfilment" className="size-4 accent-[var(--color-ink)]" disabled={disabled} checked={fulfilment === option} onChange={() => setFulfilment(option)} />
                      <span>
                        <span className="block font-semibold">{option === 'delivery' ? 'Delivery' : 'Pickup'}</span>
                        <span className="text-sm text-muted">
                          {option === 'pickup' ? 'Free · we message you when ready' : disabled ? 'Not available right now' : 'Brought to your door'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {fulfilment === 'delivery' && deliveryZones.length > 0 && (
              <label className="block font-medium">
                Delivery area
                <select required value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={fieldClass}>
                  <option value="">Choose your area</option>
                  {deliveryZones.map((z) => <option key={z.id} value={z.id}>{z.name} ({formatPrice(business.currency, z.fee)})</option>)}
                </select>
              </label>
            )}
            {fulfilment === 'delivery' && (
              <label className="block font-medium">
                Delivery location
                <textarea required rows={2} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Estate, street, house number or landmark" className={fieldClass} />
              </label>
            )}
            <label className="block font-medium">
              Note for us <span className="font-normal text-muted">(optional)</span>
              <input maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="For example, call when you arrive" className={fieldClass} />
            </label>
          </section>

          <section className={`${cardClass} space-y-4 p-5`}>
            <h2 className="text-lg font-medium">3. Payment</h2>
            <div className="flex items-center gap-3 rounded-xl border border-ink bg-amber-50 p-4">
              <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold tracking-wide text-[#2f8a3b] ring-1 ring-line">M-PESA</span>
              <span className="text-sm">After you place the order, we send a prompt to <strong>{account.phone}</strong>. Enter your PIN to pay. <a href="/payments" className="underline">How it works</a></span>
            </div>
            {rewards && (
              <PointsPanel
                rewards={rewards}
                currency={business.currency}
                enabled={usePoints}
                canUse={canUsePoints}
                maxPoints={maxPoints}
                value={points}
                used={pointsUsed}
                usedValue={pointsValue}
                onToggle={(on) => {
                  setUsePoints(on);
                  if (on && !points) setPoints(String(maxPoints));
                }}
                onChange={setPoints}
              />
            )}
          </section>
        </div>

        <aside className={`${cardClass} space-y-4 p-5 lg:sticky lg:top-36`} aria-label="Order summary">
          <h2 className="text-xl font-medium">Order summary</h2>
          <ul className="max-h-64 space-y-3 overflow-y-auto">
            {rows.map(({ line, product }) => (
              <li key={product.id} className="flex items-center gap-3">
                <span className="relative size-12 shrink-0 overflow-hidden rounded-lg"><ProductImage product={product} width={120} /></span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{product.name}</span>
                  <span className="text-muted">{line.quantity} × {formatPrice(business.currency, product.price)}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold">{formatPrice(business.currency, product.price * line.quantity)}</span>
              </li>
            ))}
          </ul>
          <PromoField subtotal={subtotal} />
          <dl className="space-y-1.5 border-t border-line pt-4">
            <div className="flex justify-between gap-3"><dt className="text-muted">Products</dt><dd>{formatPrice(business.currency, subtotal)}</dd></div>
            {fulfilment === 'delivery' && <div className="flex justify-between gap-3"><dt className="text-muted">Delivery</dt><dd>{deliveryZones.length > 0 && !zone ? 'Choose area' : formatPrice(business.currency, fee)}</dd></div>}
            {saving > 0 && <div className="flex justify-between gap-3 text-emerald-800"><dt>Promo {promo?.code}</dt><dd>-{formatPrice(business.currency, saving)}</dd></div>}
            {pointsValue > 0 && <div className="flex justify-between gap-3 text-leaf"><dt>Points ({pointsUsed.toLocaleString('en-KE')})</dt><dd>-{formatPrice(business.currency, pointsValue)}</dd></div>}
            <div className="flex justify-between gap-3 pt-1 text-xl font-semibold"><dt>Total</dt><dd>{formatPrice(business.currency, total)}</dd></div>
          </dl>
          {belowMinimum && <p className="text-muted">The minimum order is {formatPrice(business.currency, settings.minOrder)}.</p>}
          {promoCode && !promo && promoError && <p className="text-sm text-red-800">The promo code won't be used: {promoError}</p>}
          <ErrorText>{error}</ErrorText>
          <button type="submit" disabled={busy || belowMinimum} className="btn btn-accent min-h-12 w-full">
            <ShoppingBag size={18} aria-hidden />
            {busy ? 'Placing your order…' : `Place order · ${formatPrice(business.currency, total)}`}
          </button>
          <p className="flex gap-2 text-sm leading-relaxed text-muted">
            <Lock size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              By placing an order you agree to our <a href="/terms" className="underline hover:text-ink">terms</a> and{' '}
              <a href="/returns" className="underline hover:text-ink">refund policy</a>. Unpaid orders are cancelled after 48 hours.
            </span>
          </p>
        </aside>
      </form>
    </div>
  );
}

/**
 * Lets a signed-in customer take reward points off this order. Only a request: the server checks
 * the balance, the minimum and the tier value again, and takes the points in the same transaction
 * that creates the order (they come back automatically if the order is cancelled or never paid).
 */
function PointsPanel({ rewards, currency, enabled, canUse, maxPoints, value, used, usedValue, onToggle, onChange }: {
  rewards: Rewards;
  currency: string;
  enabled: boolean;
  canUse: boolean;
  maxPoints: number;
  value: string;
  used: number;
  usedValue: number;
  onToggle: (on: boolean) => void;
  onChange: (value: string) => void;
}) {
  const perShilling = rewards.pointValue > 0 ? Math.round(1 / rewards.pointValue) : 0;
  const balance = rewards.points.toLocaleString('en-KE');
  const worth = formatPrice(currency, Math.floor(rewards.points * rewards.pointValue));

  if (!canUse) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-line bg-shell p-3.5 text-sm">
        <Gift size={18} className="mt-0.5 shrink-0 text-ember" aria-hidden />
        <p className="text-muted">
          You have <strong className="font-medium text-ink">{balance} points</strong>.{' '}
          {rewards.points < rewards.minRedeem
            ? `You can use them once you have ${rewards.minRedeem.toLocaleString('en-KE')}.`
            : 'This order is too small to use them; add a little more to your cart.'}
        </p>
      </div>
    );
  }

  const typed = Number(value);
  const outOfRange = enabled && value !== '' && (typed < rewards.minRedeem || typed > maxPoints);
  return (
    <div className={`rounded-lg border p-3.5 transition ${enabled ? 'border-ember bg-amber-50' : 'border-line bg-white'}`}>
      <label className="flex cursor-pointer items-center gap-3">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-ember)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Use my points</span>
          <span className="block text-xs text-muted">{balance} points, worth {worth} · {perShilling} points = {formatPrice(currency, 1)}</span>
        </span>
        <Gift size={18} className="shrink-0 text-ember" aria-hidden />
      </label>
      {enabled && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Points to use</span>
              <input
                type="number"
                inputMode="numeric"
                min={rewards.minRedeem}
                max={maxPoints}
                step={1}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={`${fieldClass} mt-0`}
              />
            </label>
            <button type="button" onClick={() => onChange(String(maxPoints))} className="btn btn-secondary btn-sm shrink-0">
              Use most
            </button>
          </div>
          <p className={`text-xs ${outOfRange ? 'text-red-800' : 'text-muted'}`}>
            {outOfRange
              ? `Choose between ${rewards.minRedeem.toLocaleString('en-KE')} and ${maxPoints.toLocaleString('en-KE')} points. We'll use ${used.toLocaleString('en-KE')}.`
              : `${used.toLocaleString('en-KE')} points take ${formatPrice(currency, usedValue)} off. At least ${formatPrice(currency, 1)} is paid by M-Pesa.`}
          </p>
        </div>
      )}
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { fetchRewards, friendlyError, placeOrder, Rewards } from '../api';
import { navigate } from '../router';
import { useAuth, useCart, useStorefront } from '../store';
import { cardClass, ErrorText, fieldClass, formatPrice, Notice, pageClass, perUnit, primaryButton, ProductImage, secondaryButton } from '../ui';

export default function CartPage() {
  const { products, business, settings, deliveryZones } = useStorefront();
  const { lines, setQuantity, remove, clear } = useCart();
  const session = useAuth((s) => s.session);
  const account = useAuth((s) => s.account);

  const [fulfilment, setFulfilment] = useState<'delivery' | 'pickup'>(settings.deliveryEnabled ? 'delivery' : 'pickup');
  const [address, setAddress] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [points, setPoints] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (account) fetchRewards().then(setRewards).catch(() => setRewards(null));
  }, [account]);

  useEffect(() => {
    if (account?.delivery_address) setAddress((current) => current || account.delivery_address!);
  }, [account]);

  const rows = lines
    .map((line) => ({ line, product: products.find((p) => p.id === line.productId) }))
    .filter((row): row is { line: typeof row.line; product: NonNullable<typeof row.product> } => Boolean(row.product));

  if (rows.length === 0) {
    return (
      <Notice title="Your cart is empty" body="Add something from our shop, or ask our assistant what we have today.">
        <a href="/shop" className={`${primaryButton} mt-6`}>Go to the shop</a>
      </Notice>
    );
  }

  const subtotal = rows.reduce((sum, { line, product }) => sum + product.price * line.quantity, 0);
  const zone = deliveryZones.find((z) => z.id === zoneId);
  const fee = fulfilment !== 'delivery' ? 0 : Number(deliveryZones.length > 0 ? zone?.fee ?? 0 : settings.deliveryFee);
  // M-Pesa only takes whole shillings, so the server rounds the total down the same way.
  const pointsUsed = Number(points) > 0 ? Math.floor(Number(points)) : 0;
  const pointsValue = rewards ? pointsUsed * rewards.pointValue : 0;
  const total = Math.floor(subtotal + fee - pointsValue);
  const belowMinimum = subtotal < settings.minOrder;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const orderId = await placeOrder(lines, fulfilment, address, notes, zoneId || null, pointsUsed);
      clear();
      navigate(`/account/orders/${orderId}`);
    } catch (err) {
      setError(friendlyError(err, "We couldn't place your order. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={pageClass}>
      <h1 className="text-4xl font-bold">Your cart</h1>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <ul className="space-y-4">
          {rows.map(({ line, product }) => (
            <li key={product.id} className={`${cardClass} flex gap-3 p-3 sm:gap-4 sm:p-4`}>
              <div className="size-20 shrink-0 overflow-hidden rounded-lg sm:size-24">
                <ProductImage product={product} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{product.name}</h2>
                    <p className="text-sm text-muted">
                      {formatPrice(business.currency, product.price)} / {perUnit(product.unit)}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(product.id)}
                    aria-label={`Remove ${product.name}`}
                    className="grid size-11 shrink-0 place-items-center text-muted hover:text-red-700"
                  >
                    <Trash2 size={19} aria-hidden />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center">
                    <button
                      aria-label={`Less ${product.name}`}
                      onClick={() => setQuantity(product.id, Math.max(0.5, line.quantity - (line.quantity > 1 ? 1 : 0.5)))}
                      className="grid size-11 place-items-center rounded-l-lg border border-line"
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
                        className="h-11 w-16 border-y border-line text-center text-base"
                      />
                    </label>
                    <button
                      aria-label={`More ${product.name}`}
                      onClick={() => setQuantity(product.id, line.quantity + 1)}
                      className="grid size-11 place-items-center rounded-r-lg border border-line"
                    >
                      <Plus size={17} aria-hidden />
                    </button>
                  </div>
                  <p className="font-bold">{formatPrice(business.currency, product.price * line.quantity)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <form onSubmit={handleSubmit} className={`${cardClass} space-y-5 p-5 lg:sticky lg:top-20`}>
          <fieldset>
            <legend className="font-semibold">How would you like to receive it?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['delivery', 'pickup'] as const).map((option) => (
                <label
                  key={option}
                  className={`flex min-h-11 items-center justify-center rounded-lg border px-3 text-center font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brand-deep ${
                    fulfilment === option ? 'border-brand bg-amber-50' : 'border-line'
                  } ${option === 'delivery' && !settings.deliveryEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="fulfilment"
                    className="sr-only"
                    disabled={option === 'delivery' && !settings.deliveryEnabled}
                    checked={fulfilment === option}
                    onChange={() => setFulfilment(option)}
                  />
                  {option === 'delivery' ? 'Delivery' : 'Pickup'}
                </label>
              ))}
            </div>
          </fieldset>

          {fulfilment === 'delivery' && deliveryZones.length > 0 && (
            <label className="mt-4 block font-medium">
              Delivery area
              <select required value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={fieldClass}>
                <option value="">Choose your area</option>
                {deliveryZones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name} ({formatPrice(business.currency, z.fee)})</option>
                ))}
              </select>
            </label>
          )}
          {fulfilment === 'delivery' && (
            <label className="block font-medium">
              Delivery location
              <textarea
                required
                rows={2}
                maxLength={300}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Estate, street, house number or landmark"
                className={fieldClass}
              />
            </label>
          )}

          <label className="block font-medium">
            Note for us <span className="font-normal text-muted">(optional)</span>
            <input maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} className={fieldClass} />
          </label>

          {rewards && rewards.points >= rewards.minRedeem && (
            <label className="mb-4 block font-medium">
              Use points ({rewards.points} available, each worth {formatPrice(business.currency, rewards.pointValue)})
              <input
                type="number"
                inputMode="numeric"
                min={rewards.minRedeem}
                max={rewards.points}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder={`From ${rewards.minRedeem} points`}
                className={fieldClass}
              />
            </label>
          )}
          <dl className="space-y-1.5 border-t border-line pt-4">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Products</dt>
              <dd>{formatPrice(business.currency, subtotal)}</dd>
            </div>
            {fulfilment === 'delivery' && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Delivery</dt>
                <dd>{formatPrice(business.currency, fee)}</dd>
              </div>
            )}
            {pointsValue > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Points</dt>
                <dd>-{formatPrice(business.currency, pointsValue)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 text-xl font-bold">
              <dt>Total</dt>
              <dd>{formatPrice(business.currency, total)}</dd>
            </div>
          </dl>

          {belowMinimum && (
            <p className="text-muted">The minimum order is {formatPrice(business.currency, settings.minOrder)}.</p>
          )}
          <ErrorText>{error}</ErrorText>

          {session && account ? (
            <button type="submit" disabled={busy || belowMinimum} className={`${primaryButton} w-full`}>
              <ShoppingCart size={18} aria-hidden />
              {busy ? 'Placing your order…' : 'Continue to payment'}
            </button>
          ) : (
            <a href="/account" className={`${secondaryButton} w-full`}>Sign in to order</a>
          )}
        </form>
      </div>
    </div>
  );
}

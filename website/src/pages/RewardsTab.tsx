import { useCallback, useEffect, useState } from 'react';
import { fetchRewards, friendlyError, redeemPoints, Rewards } from '../api';
import { ErrorText, fieldClass, Loading, primaryButton } from '../ui';
import { useStorefront } from '../store';
import ReferralPanel from './ReferralPanel';

export default function RewardsTab() {
  const { business } = useStorefront();
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setRewards(await fetchRewards());
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!rewards) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  // Points here only pay off what is owed; the database takes no more than the debt needs.
  const perShilling = rewards.pointValue > 0 ? Math.round(1 / rewards.pointValue) : 0;
  const debtNeeds = rewards.pointValue > 0 ? Math.ceil(rewards.debt / rewards.pointValue) : 0;
  const canPayDebt = rewards.debt > 0 && rewards.points >= rewards.minRedeem;
  const requested = Number(points);
  const valid = Number.isInteger(requested) && requested >= rewards.minRedeem && requested <= rewards.points;

  const handleRedeem = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await redeemPoints(requested);
      setPoints('');
      setMessage(
        res && typeof res.value === 'number'
          ? `${res.pointsUsed.toLocaleString('en-KE')} points took Ksh ${res.value.toLocaleString('en-KE')} off what you owe.`
          : 'Your points were used to pay off what you owe.',
      );
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-white p-5">
        <div><dt className="text-muted">Points</dt><dd className="text-2xl font-semibold">{rewards.points}</dd></div>
        <div><dt className="text-muted">Tier</dt><dd className="text-2xl font-semibold">{rewards.tier}</dd></div>
        <div><dt className="text-muted">Wallet</dt><dd className="text-xl font-semibold">Ksh {rewards.wallet}</dd></div>
        <div><dt className="text-muted">Owed</dt><dd className="text-xl font-semibold">Ksh {rewards.debt}</dd></div>
      </dl>

      {rewards.enabled === false ? (
        <p className="rounded-xl bg-sand p-4 text-muted">
          Points are paused for now. Your points stay in your account.
        </p>
      ) : (
      <div>
        <h2 className="text-xl font-semibold">Using your points</h2>
        <p className="mt-1 text-muted">
          {rewards.tier}: {perShilling.toLocaleString('en-KE')} points = Ksh 1 off. You can use points from{' '}
          {rewards.minRedeem.toLocaleString('en-KE')} points, in your cart to take money off an order, or here to pay off
          what you owe us. Points can't be exchanged for cash, M-Pesa or wallet money.
        </p>
        {canPayDebt ? (
          <>
            <label className="mt-4 block font-medium">
              Points to pay off what you owe
              <span className="block text-sm font-normal text-muted">
                Clearing all of it takes {debtNeeds.toLocaleString('en-KE')} points. We never use more than it needs.
              </span>
              <input type="number" inputMode="numeric" min={rewards.minRedeem} max={rewards.points} value={points} onChange={(e) => setPoints(e.target.value)} className={fieldClass} />
            </label>
            <ErrorText>{error}</ErrorText>
            <button onClick={handleRedeem} disabled={busy || !valid} className={`${primaryButton} mt-4 w-full sm:w-auto`}>
              {busy ? 'Please wait…' : 'Pay with points'}
            </button>
          </>
        ) : (
          <ErrorText>{error}</ErrorText>
        )}
        {message && <p role="status" className="mt-2 font-medium text-emerald-700">{message}</p>}
      </div>
      )}
      <ReferralPanel shopName={business.name} />
    </div>
  );
}

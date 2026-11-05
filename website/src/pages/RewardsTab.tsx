import { useCallback, useEffect, useState } from 'react';
import { fetchRewards, friendlyError, redeemPoints, Rewards } from '../api';
import { ErrorText, fieldClass, Loading, primaryButton } from '../ui';

export default function RewardsTab() {
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

  const requested = Number(points);
  const valid = Number.isInteger(requested) && requested >= rewards.minRedeem && requested <= rewards.points;

  const handleRedeem = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await redeemPoints(requested);
      setPoints('');
      setMessage(`${requested} points are now on your account.`);
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
        <div><dt className="text-muted">Points</dt><dd className="text-2xl font-bold">{rewards.points}</dd></div>
        <div><dt className="text-muted">Tier</dt><dd className="text-2xl font-bold">{rewards.tier}</dd></div>
        <div><dt className="text-muted">Wallet</dt><dd className="text-xl font-semibold">Ksh {rewards.wallet}</dd></div>
        <div><dt className="text-muted">Owed</dt><dd className="text-xl font-semibold">Ksh {rewards.debt}</dd></div>
      </dl>

      <div>
        <h2 className="text-xl font-bold">Redeem points</h2>
        <p className="mt-1 text-muted">
          Each point is worth Ksh {rewards.pointValue}. You can redeem from {rewards.minRedeem} points.
          You can also use points in your cart to pay part of an order. Redeeming here clears anything you
          owe first, then goes to your wallet for spending at our shop. Points can't be exchanged for cash.
        </p>
        <label className="mt-4 block font-medium">
          Points to redeem
          <input type="number" inputMode="numeric" min={rewards.minRedeem} max={rewards.points} value={points} onChange={(e) => setPoints(e.target.value)} className={fieldClass} />
        </label>
        <ErrorText>{error}</ErrorText>
        {message && <p role="status" className="mt-2 font-medium text-emerald-700">{message}</p>}
        <button onClick={handleRedeem} disabled={busy || !valid} className={`${primaryButton} mt-4 w-full sm:w-auto`}>
          {busy ? 'Please wait…' : 'Redeem'}
        </button>
      </div>
    </div>
  );
}

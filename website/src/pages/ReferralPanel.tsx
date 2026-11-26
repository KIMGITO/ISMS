// "Invite friends": the customer's referral code, a share button and how it's doing.
// Only shown while the shop runs a referral programme (or the customer has referred before).
import { useEffect, useState } from 'react';
import { fetchMyReferral, MyReferral } from '../api';
import { formatPrice, primaryButton, secondaryButton } from '../ui';

const STATUS: Record<string, string> = {
  pending: 'waiting', qualified: 'bought, reward coming', rewarded: 'rewarded', rejected: 'not counted', expired: 'not finished',
};

export default function ReferralPanel({ shopName }: { shopName: string }) {
  const [r, setR] = useState<MyReferral | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetchMyReferral().then(setR);
  }, []);
  if (!r || !r.linked || !r.code || (!r.running && !r.invited)) return null;

  const c = r.campaign;
  const min = c && Number(c.minPurchase) > 0 ? ` on a first purchase of ${formatPrice('Ksh', Number(c.minPurchase))} or more` : '';
  const text = `Shop at ${shopName} and give my code ${r.code} at the counter: you get ${c?.friendGets ?? 'a welcome reward'}${min}.`;
  const active = r.codeStatus === 'active' && !!c;

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch { /* closed the share sheet */ return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  return (
    <section className="rounded-xl border border-line bg-white p-5 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Invite friends</h2>
        {active ? (
          <p className="mt-1 text-muted">
            Your friend gets {c!.friendGets}{min}. You get {c!.youGet} once they've bought. Share as often as you like.
          </p>
        ) : (
          <p className="mt-1 text-muted">Referrals are paused at the moment. Rewards you've earned stay yours.</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-sand px-4 py-3">
        <span className="text-sm text-muted">Your code</span>
        <span className="font-mono text-2xl font-semibold tracking-wider">{r.code}</span>
      </div>
      {active && (
        <div className="pill-row gap-2">
          <button onClick={share} className={primaryButton}>Share my code</button>
          <button onClick={copy} className={secondaryButton}>{copied ? 'Copied' : 'Copy message'}</button>
        </div>
      )}
      <dl className="grid grid-cols-3 gap-3 text-center">
        <div><dt className="text-sm text-muted">Invited</dt><dd className="text-xl font-semibold">{r.invited ?? 0}</dd></div>
        <div><dt className="text-sm text-muted">Successful</dt><dd className="text-xl font-semibold">{r.successful ?? 0}</dd></div>
        <div><dt className="text-sm text-muted">Waiting</dt><dd className="text-xl font-semibold">{r.pending ?? 0}</dd></div>
      </dl>
      {(r.rewardsEarned ?? 0) > 0 && (
        <div className="text-sm">
          <p className="font-medium">
            Rewards earned: {r.rewardsEarned}
            {(r.walletEarned ?? 0) > 0 && <> · {formatPrice('Ksh', Number(r.walletEarned))} added to your wallet</>}
            {(r.pointsEarned ?? 0) > 0 && <> · {Number(r.pointsEarned).toLocaleString('en-KE')} points</>}
            {' '}· used {r.rewardsUsed ?? 0}
          </p>
          {(r.rewardsAvailable ?? []).length > 0 && (
            <ul className="mt-1 space-y-1">
              {r.rewardsAvailable!.map((w, i) => (
                <li key={i} className="flex justify-between gap-2 rounded-lg bg-sand px-3 py-2">
                  <span>{w.what}: give code <b className="font-mono">{w.code}</b> at the counter</span>
                  {w.expiresAt && <span className="text-muted">until {new Date(w.expiresAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(r.friends ?? []).length > 0 && (
        <ul className="text-sm text-muted">
          {r.friends!.map((f, i) => <li key={i}>{f.name}: {STATUS[f.status] ?? f.status}</li>)}
        </ul>
      )}
    </section>
  );
}

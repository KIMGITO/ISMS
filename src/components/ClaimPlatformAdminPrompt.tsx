// The first person to sign up is asked to become the platform admin (runs the console).
// The database decides: it offers this only while nobody is admin, and closes it for good
// once someone has claimed it.
import { useEffect, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';
import { forgetPlatformAdmin, setConsoleOpen } from '../utils/platformConsole';

export default function ClaimPlatformAdminPrompt({ userId, name }: { userId: string | null | undefined; name?: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return setShow(false);
    let live = true;
    getSupabase()
      .rpc('platform_admin_claimable')
      .then(({ data, error: e }) => {
        if (live) setShow(!e && data === true);
      });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!show || !userId) return null;

  const claim = async () => {
    setBusy(true);
    setError('');
    const { error: e } = await getSupabase().rpc('claim_platform_admin', { p_name: name ?? null });
    setBusy(false);
    if (e) return setError(e.message);
    forgetPlatformAdmin(userId);
    setShow(false);
    setConsoleOpen(true);
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-app-card border border-app-border p-5 space-y-3 text-app-text">
        <h2 className="text-base font-semibold">Become the platform admin?</h2>
        <p className="text-sm text-app-text-muted">
          You are the first person here. The platform admin runs the console: businesses, plans and payments.
          Once set, this can't be changed from the app.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => setShow(false)} className="px-3 py-2 text-sm rounded-xl border border-app-border cursor-pointer">
            Not now
          </button>
          <button type="button" disabled={busy} onClick={claim} className="px-3 py-2 text-sm font-semibold rounded-xl bg-amber-500 text-slate-950 cursor-pointer disabled:opacity-60">
            {busy ? 'Setting...' : 'Make me admin'}
          </button>
        </div>
      </div>
    </div>
  );
}

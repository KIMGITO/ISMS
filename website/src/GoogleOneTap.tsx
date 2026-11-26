import { useEffect } from 'react';
import { isProviderEnabled, supabase } from './api';
import { useAuth } from './store';

/*
 * Google One Tap: a visitor already signed in to Google in this browser gets Google's own
 * "Sign in as <name>" box in the top-right corner (a bottom sheet on phones). Nothing happens
 * until they tap their account to confirm. The sign-in lands on the branch being browsed:
 * the account is created for storeSlug() and App moves an existing account to it.
 *
 * Needs VITE_GOOGLE_CLIENT_ID (the same Web client ID that is set on Supabase's Google provider).
 */

const CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DISMISS_KEY = 'google-one-tap-dismissed';

interface GoogleId {
  initialize: (config: Record<string, unknown>) => void;
  prompt: (listener?: (n: { isDismissedMoment?: () => boolean; getDismissedReason?: () => string }) => void) => void;
  cancel: () => void;
}
declare global {
  interface Window { google?: { accounts?: { id?: GoogleId } } }
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? Object.assign(document.createElement('script'), { src: SCRIPT_SRC, async: true, defer: true });
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Google sign-in script blocked')));
    if (!existing) document.head.appendChild(script);
  });
}

/** Google gets the hash of a one-time value, Supabase the value itself, so a stolen token can't be replayed. */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function GoogleOneTap({ section }: { section: string }) {
  const ready = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.session);

  useEffect(() => {
    if (!CLIENT_ID || !ready || signedIn || dismissedRecently()) return;
    // Not on the sign-in page itself (it has the Google button) or inside an app preview frame.
    if (section === 'account' || window.self !== window.top) return;
    let cancelled = false;

    (async () => {
      if (!(await isProviderEnabled('google'))) return;
      await loadScript();
      const id = window.google?.accounts?.id;
      if (!id || cancelled) return;
      const nonce = await makeNonce();
      id.initialize({
        client_id: CLIENT_ID,
        nonce: nonce.hashed,
        auto_select: false,          // always ask: the visitor confirms "Sign in as ..."
        cancel_on_tap_outside: true,
        context: 'signin',
        itp_support: true,
        use_fedcm_for_prompt: true,
        callback: async ({ credential }: { credential: string }) => {
          const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: nonce.raw });
          if (error) {
            console.error('Google One Tap sign-in failed:', error.message);
            return;
          }
        },
      });
      id.prompt((n) => {
        if (n.isDismissedMoment?.() && n.getDismissedReason?.() === 'cancel_called') return;
        if (n.isDismissedMoment?.()) {
          try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
        }
      });
    })().catch((err) => console.warn('Google One Tap not shown:', err));

    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel();
    };
  }, [ready, signedIn, section]);

  return null;
}

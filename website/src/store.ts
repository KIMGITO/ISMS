import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Session } from '@supabase/supabase-js';
import { Account, CartLine, createAccount, fetchAccount, Storefront, supabase } from './api';

const safeStorage = createJSONStorage(() => ({
  getItem: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* cart just won't persist */ } },
  removeItem: (key) => { try { localStorage.removeItem(key); } catch { /* nothing to remove */ } },
}));

interface CartState {
  lines: CartLine[];
  add: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (productId, quantity = 1) =>
        set((s) => {
          const existing = s.lines.find((l) => l.productId === productId);
          return {
            lines: existing
              ? s.lines.map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + quantity } : l))
              : [...s.lines, { productId, quantity }],
          };
        }),
      setQuantity: (productId, quantity) =>
        set((s) => ({ lines: s.lines.map((l) => (l.productId === productId ? { ...l, quantity } : l)) })),
      remove: (productId) => set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) })),
      clear: () => set({ lines: [] }),
    }),
    { name: 'kaykays-cart', storage: safeStorage },
  ),
);

export const useSite = create<{ site: Storefront | null; setSite: (site: Storefront) => void }>((set) => ({
  site: null,
  setSite: (site) => set({ site }),
}));

/** The storefront is loaded before any page renders. */
export const useStorefront = () => useSite((s) => s.site!);

interface AuthState {
  ready: boolean;
  session: Session | null;
  account: Account | null;
  recovering: boolean;
  refreshAccount: () => Promise<void>;
  setRecovering: (recovering: boolean) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  session: null,
  account: null,
  recovering: false,
  setRecovering: (recovering) => set({ recovering }),
  refreshAccount: async () => {
    const { session } = get();
    if (!session) {
      set({ account: null });
      return;
    }
    let account = await fetchAccount();
    if (!account) {
      // Name and phone are kept in the sign-up metadata until the email is confirmed.
      const meta = session.user.user_metadata;
      if (meta?.name && meta?.customer_phone) {
        await createAccount(meta.name, meta.customer_phone);
        account = await fetchAccount();
      }
    }
    set({ account });
  },
}));

export function startAuthListener() {
  const applySession = async (session: Session | null) => {
    useAuth.setState({ session });
    try {
      await useAuth.getState().refreshAccount();
    } catch (err) {
      console.error('Could not load account:', err);
    }
    useAuth.setState({ ready: true });
  };

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      useAuth.setState({ recovering: true });
    }
    // Supabase warns against awaiting its own calls inside this callback.
    setTimeout(() => applySession(session), 0);
  });
}

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Session } from '@supabase/supabase-js';
import { Account, CartLine, createAccount, fetchAccount, friendlyError, saveOffersChoice, Storefront, supabase } from './api';

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
  setSite: (site) => {
    // A saved cart can name products this shop no longer has (another branch, or products added
    // again since). They can't be shown or ordered, so they leave the cart.
    const ids = new Set(site.products.map((p) => p.id));
    const { lines } = useCart.getState();
    const kept = lines.filter((l) => ids.has(l.productId));
    if (kept.length !== lines.length) useCart.setState({ lines: kept });
    set({ site });
  },
}));

/** The storefront is loaded before any page renders. */
export const useStorefront = () => useSite((s) => s.site!);

interface AuthState {
  ready: boolean;
  session: Session | null;
  account: Account | null;
  recovering: boolean;
  refreshAccount: () => Promise<void>;
  /** Why the account couldn't be loaded or created, in words a customer understands. */
  accountError: string;
  setRecovering: (recovering: boolean) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  session: null,
  account: null,
  recovering: false,
  accountError: '',
  setRecovering: (recovering) => set({ recovering }),
  refreshAccount: async () => {
    const { session } = get();
    if (!session) {
      set({ account: null, accountError: '' });
      return;
    }
    try {
      let account = await fetchAccount();
      if (!account) {
        // Name and phone are kept in the sign-up metadata until the email is confirmed.
        const meta = session.user.user_metadata;
        if (meta?.account_type === 'customer' && meta?.name && meta?.customer_phone) {
          await createAccount(meta.name, meta.customer_phone);
          if (meta.offers === true) await saveOffersChoice(true).catch(() => undefined);
          account = await fetchAccount();
        }
      }
      set({ account, accountError: '' });
    } catch (err) {
      set({ account: null, accountError: friendlyError(err, 'We couldn\'t open your account. Please refresh the page and try again.') });
      throw err;
    }
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

interface SavedState {
  ids: string[];
  toggle: (productId: string) => void;
}

/** Products a shopper has saved for later. Kept on this device only. */
export const useSaved = create<SavedState>()(
  persist(
    (set) => ({
      ids: [],
      toggle: (productId) =>
        set((s) => ({ ids: s.ids.includes(productId) ? s.ids.filter((id) => id !== productId) : [productId, ...s.ids] })),
    }),
    { name: 'kaykays-saved', storage: safeStorage },
  ),
);

interface RecentState {
  ids: string[];
  view: (productId: string) => void;
}

/** The last few products opened on this device, newest first. */
export const useRecent = create<RecentState>()(
  persist(
    (set) => ({
      ids: [],
      view: (productId) => set((s) => ({ ids: [productId, ...s.ids.filter((id) => id !== productId)].slice(0, 8) })),
    }),
    { name: 'kaykays-recent', storage: safeStorage },
  ),
);

/** The slide-in cart, the menu, the categories list and the store picker. Only one is open at a time. */
export type Panel = 'cart' | 'menu' | 'categories' | 'store';
export const usePanels = create<{ panel: Panel | null; open: (panel: Panel) => void; close: () => void }>((set) => ({
  panel: null,
  open: (panel) => set({ panel }),
  close: () => set({ panel: null }),
}));

/** A short message after adding to cart, with a shortcut to the cart. */
export const useToast = create<{ message: string | null; id: number; show: (message: string) => void; hide: () => void }>((set) => ({
  message: null,
  id: 0,
  show: (message) => set((s) => ({ message, id: s.id + 1 })),
  hide: () => set({ message: null }),
}));

/** The promo code typed in the cart, carried to checkout. The server checks it again there. */
export const usePromo = create<{ code: string; setCode: (code: string) => void }>()(
  persist(
    (set) => ({ code: '', setCode: (code) => set({ code }) }),
    { name: 'kaykays-promo', storage: safeStorage },
  ),
);

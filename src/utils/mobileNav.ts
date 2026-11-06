// Decides which tabs sit on the mobile bottom bar and which go to the "More" sheet.
// The bar holds at most 5 slots. When a role can reach more tabs than fit, the
// fifth slot is "More". Settings and About always go to More, never on the bar.

export const MAX_BOTTOM_TABS = 5;
export const MORE_TAB_ID = 'more';

const NEVER_ON_BAR = new Set(['settings', 'about']);

// Most-used first for each role. Tabs a role can't reach are skipped.
const ROLE_PRIORITY: Record<string, string[]> = {
  Cashier: ['dashboard', 'pos', 'sell', 'sales', 'customers'],
  Rider: ['deliveries', 'dashboard', 'ai', 'profile'],
  Owner: ['home', 'sales', 'inventory', 'customers', 'dashboard'],
  Admin: ['home', 'sales', 'inventory', 'customers', 'dashboard'],
  Administrator: ['home', 'sales', 'inventory', 'customers', 'dashboard'],
  Manager: ['home', 'sales', 'inventory', 'customers', 'dashboard'],
};

// Used for roles without their own list, and to order everything else.
const DEFAULT_PRIORITY = [
  'home', 'dashboard', 'sell', 'pos', 'sales', 'inventory', 'customers', 'deliveries',
  'online-store', 'production', 'feedback', 'workers', 'ai', 'permissions',
  'money', 'business-management', 'profile', 'settings', 'about',
];

function rank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * @param allowedTabIds tabs the person may open, already filtered by permission
 * @param role the signed-in person's role
 * @returns `primary` for the bar (may include MORE_TAB_ID) and `overflow` for the More sheet
 */
export function arrangeMobileNav(allowedTabIds: string[], role: string | undefined) {
  const rolePriority = ROLE_PRIORITY[role || ''] || [];
  const order = [...rolePriority, ...DEFAULT_PRIORITY.filter((id) => !rolePriority.includes(id))];
  const sorted = [...allowedTabIds].sort((a, b) => rank(order, a) - rank(order, b));

  const barCandidates = sorted.filter((id) => !NEVER_ON_BAR.has(id));
  const needsMore = sorted.length > MAX_BOTTOM_TABS || barCandidates.length < sorted.length;

  const primary = needsMore ? barCandidates.slice(0, MAX_BOTTOM_TABS - 1) : barCandidates;
  const overflow = sorted.filter((id) => !primary.includes(id));

  // Cashiers get Quick Sale in the middle slot.
  if (role === 'Cashier' && primary.includes('sell')) {
    const withoutSell = primary.filter((id) => id !== 'sell');
    const slots = needsMore ? [...withoutSell, MORE_TAB_ID] : withoutSell;
    const middle = Math.floor(slots.length / 2);
    slots.splice(middle, 0, 'sell');
    return { primary: slots, overflow };
  }

  return { primary: needsMore ? [...primary, MORE_TAB_ID] : primary, overflow };
}

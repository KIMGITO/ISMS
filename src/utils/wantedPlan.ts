// src/utils/wantedPlan.ts
// The plan someone picked on the public plans page (SaaS step 7). The page links to the app as
// ?plan=<code>&cycle=monthly|annual; the app keeps it until they are signed in, and the start
// screen opens that plan's summary (or the free trial) straight away.

const KEY = 'kkm_wanted_plan';

export interface WantedPlan {
  plan: string;
  cycle: 'monthly' | 'annual';
}

/** Reads ?plan= / ?cycle= from the address once, keeps them, and tidies the address. */
export function captureWantedPlan(): boolean {
  const url = new URL(window.location.href);
  const plan = (url.searchParams.get('plan') ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
  if (!plan) return false;
  const cycle = url.searchParams.get('cycle') === 'annual' ? 'annual' : 'monthly';
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ plan, cycle }));
  } catch {
    /* they pick it again in the app */
  }
  url.searchParams.delete('plan');
  url.searchParams.delete('cycle');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return true;
}

export function readWantedPlan(): WantedPlan | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return v && typeof v.plan === 'string' ? { plan: v.plan, cycle: v.cycle === 'annual' ? 'annual' : 'monthly' } : null;
  } catch {
    return null;
  }
}

export function clearWantedPlan(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

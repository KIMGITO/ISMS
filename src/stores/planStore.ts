// src/stores/planStore.ts
// The plan of the company the open branch belongs to: limits, use, and which modules it has.
// The database is the truth (has_permission refuses locked modules, triggers refuse limits);
// this copy only decides what the app shows, so locked screens, actions, roles and search
// results never appear. A saved copy per branch keeps it right when offline.

import { create } from "zustand";
import { getSupabase } from "../services/supabaseClient";
import { useBusinessStore, onBranchChange } from "./businessStore";

export interface PlanUsage {
  tenant_id: string;
  plan: string;
  plan_name: string;
  kind: "trial" | "subscription" | "perpetual";
  /** trial | active | grace | read_only | suspended */
  status: string;
  writable: boolean;
  billing_cycle: string | null;
  trial_ends_at: string | null;
  period_end: string | null;
  max_branches: number;
  max_staff: number;
  storage_mb: number;
  ai_daily_cap: number;
  modules: string[];
  addons: string[];
  own_ai_key: boolean;
  powered_by: boolean;
  company_name: string;
  branches_used: number;
  staff_used: number;
  staff_pending: number;
  is_company_owner: boolean;
  /** Set by the app when the database has no plans yet (older server): nothing is locked. */
  legacy?: boolean;
}

export interface PlanModule {
  key: string;
  name: string;
  tier: "growth" | "advanced";
  addable: boolean;
  sort: number;
  /** Price as an add-on on Pro (null = ask us). */
  addon_monthly_price?: number | null;
  addon_annual_price?: number | null;
}

export interface PlanRow {
  code: string;
  name: string;
  kind: string;
  description: string | null;
  monthly_price: number | null;
  annual_price: number | null;
  one_time_price: number | null;
  /** Paid once when the plan starts. */
  setup_fee?: number | null;
  max_branches: number;
  max_staff: number;
  storage_mb: number;
  ai_daily_cap: number;
  ai_addon_daily_cap: number;
  modules: string[];
  addons_allowed: boolean;
  own_ai_key: boolean;
  is_public: boolean;
  active: boolean;
  sort: number;
}

/** Same rows as module_permissions in 20261204001 (used until the database copy loads). */
const DEFAULT_PATTERNS: Array<[string, string]> = [
  ["suppliers.%", "buying"], ["purchases.%", "buying"], ["supplier_bills.%", "buying"],
  ["supplier_portal.%", "buying"],
  ["inventory.transfer_stock", "transfers"], ["inventory.receive_stock", "transfers"],
  ["inventory.request_transfer", "transfers"],
  ["deliveries.%", "deliveries"], ["orders.assign_rider", "deliveries"],
  ["settings.delivery", "deliveries"], ["reports.deliveries", "deliveries"],
  ["promotions.%", "promotions"], ["referrals.%", "promotions"], ["loyalty.%", "promotions"],
  ["customers.loyalty", "promotions"], ["pos.apply_promotion", "promotions"],
  ["customers.schedules", "regular_orders"],
  ["bom.%", "production"], ["production.%", "production"],
  ["quotes.%", "quotes"], ["sales_orders.%", "quotes"],
  ["communication.%", "messaging"],
  ["online_store.%", "online_store"],
  ["accounting.%", "accounting"],
  ["ai.%", "ai"],
];

const PLAN_KEY = (businessId: string) => `kkm_plan_v1_${businessId}`;
/** Saved copies already read from storage (permission checks run often). */
const savedMemo = new Map<string, PlanUsage | null>();
function savedPlan(id: string): PlanUsage | null {
  if (!savedMemo.has(id)) savedMemo.set(id, readJson<PlanUsage>(PLAN_KEY(id)));
  return savedMemo.get(id) ?? null;
}
const PATTERNS_KEY = "kkm_plan_patterns_v1";
const CATALOGUE_KEY = "kkm_plan_catalogue_v1";

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the in-memory copy still works */
  }
}

/** Compiled patterns, longest first, like fn_permission_module. */
type Compiled = { re: RegExp; len: number; module: string };
function compile(patterns: Array<[string, string]>): Compiled[] {
  return patterns
    .map(([p, module]) => ({
      re: new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$"),
      len: p.length,
      module,
    }))
    .sort((a, b) => b.len - a.len);
}

const savedPatterns = readJson<Array<[string, string]>>(PATTERNS_KEY);
let compiled = compile(savedPatterns && savedPatterns.length ? savedPatterns : DEFAULT_PATTERNS);
const moduleCache = new Map<string, string | null>();

/** The module a permission belongs to, or null when it is core (every plan). */
export function permissionModule(code: string): string | null {
  if (moduleCache.has(code)) return moduleCache.get(code)!;
  const hit = compiled.find((c) => c.re.test(code))?.module ?? null;
  moduleCache.set(code, hit);
  return hit;
}

/** Errors the database raises for a missing function (older server without plans). */
function isMissingFunction(err: any): boolean {
  const code = String(err?.code ?? "");
  return code === "PGRST202" || code === "42883";
}

interface PlanState {
  /** Plan per branch id. */
  byBusiness: Record<string, PlanUsage>;
  /** Branch ids whose plan has been asked for at least once this run (loaded or failed). */
  settled: Record<string, boolean>;
  modules: PlanModule[];
  catalogue: PlanRow[];
  loadPlan: (businessId?: string, force?: boolean) => Promise<PlanUsage | null>;
  loadCatalogue: () => Promise<void>;
}

const lastLoad: Record<string, number> = {};

export const usePlanStore = create<PlanState>((set, get) => ({
  byBusiness: {},
  settled: {},
  modules: readJson<PlanModule[]>(CATALOGUE_KEY + "_modules") ?? [],
  catalogue: readJson<PlanRow[]>(CATALOGUE_KEY) ?? [],

  loadPlan: async (businessId, force = false) => {
    const id = businessId ?? useBusinessStore.getState().activeBusinessId;
    if (!id) return null;
    // A saved copy shows at once; the database answer replaces it.
    if (!get().byBusiness[id]) {
      const saved = savedPlan(id);
      if (saved) set({ byBusiness: { ...get().byBusiness, [id]: saved } });
    }
    if (!force && lastLoad[id] && Date.now() - lastLoad[id] < 30_000) return get().byBusiness[id] ?? null;
    lastLoad[id] = Date.now();

    const supabase = getSupabase();
    try {
      const [usage, patterns] = await Promise.all([
        supabase.rpc("get_plan_usage", { p_business_id: id }),
        supabase.from("module_permissions").select("pattern, module"),
      ]);
      if (usage.error) throw usage.error;
      if (!patterns.error && Array.isArray(patterns.data) && patterns.data.length) {
        const rows = patterns.data.map((r: any) => [r.pattern, r.module] as [string, string]);
        compiled = compile(rows);
        moduleCache.clear();
        writeJson(PATTERNS_KEY, rows);
      }
      const plan = usage.data as PlanUsage | null;
      if (plan) {
        plan.modules = Array.isArray(plan.modules) ? plan.modules : [];
        plan.addons = Array.isArray(plan.addons) ? plan.addons : [];
        writeJson(PLAN_KEY(id), plan);
        savedMemo.set(id, plan);
        set({ byBusiness: { ...get().byBusiness, [id]: plan }, settled: { ...get().settled, [id]: true } });
      } else {
        set({ settled: { ...get().settled, [id]: true } });
      }
      return plan;
    } catch (err: any) {
      if (isMissingFunction(err)) {
        // The server has no plans yet: show everything, the server still checks each action.
        const legacy = { legacy: true, modules: [], addons: [], writable: true } as unknown as PlanUsage;
        set({ byBusiness: { ...get().byBusiness, [id]: legacy }, settled: { ...get().settled, [id]: true } });
        return legacy;
      }
      console.warn("Could not load the plan; using the saved copy", err);
      set({ settled: { ...get().settled, [id]: true } });
      return get().byBusiness[id] ?? null;
    }
  },

  loadCatalogue: async () => {
    const supabase = getSupabase();
    const [plans, modules] = await Promise.all([
      supabase.from("plans").select("*").eq("active", true).order("sort"),
      supabase.from("plan_modules").select("*").order("sort"),
    ]);
    if (!plans.error && plans.data) {
      writeJson(CATALOGUE_KEY, plans.data);
      set({ catalogue: plans.data as PlanRow[] });
    }
    if (!modules.error && modules.data) {
      writeJson(CATALOGUE_KEY + "_modules", modules.data);
      set({ modules: modules.data as PlanModule[] });
    }
  },
}));

/** The plan of the open branch (null until known). */
let planOverride: PlanUsage | null = null;
/** Unit tests only: answer as if the open branch had this plan (no branch change, no network). */
export function setPlanOverrideForTests(plan: PlanUsage | null): void {
  planOverride = plan;
}

export function currentPlan(): PlanUsage | null {
  if (planOverride) return planOverride;
  const id = useBusinessStore.getState().activeBusinessId;
  if (!id) return null;
  const known = usePlanStore.getState().byBusiness[id];
  if (known) return known;
  // Not asked yet this run: the saved copy (read only, so this is safe during render).
  return savedPlan(id);
}

/**
 * Does the open branch's plan include this module? Core (null) always does. Unknown plan =
 * core only, so nothing paid-for shows before the plan is known.
 */
export function hasModule(module: string | null | undefined): boolean {
  if (!module) return true;
  const plan = currentPlan();
  if (!plan) return false;
  if (plan.legacy) return true;
  return plan.modules.includes(module);
}

/** May the open branch's plan use this permission at all (whatever the role)? */
export function planAllowsPermission(code: string): boolean {
  return hasModule(permissionModule(code));
}

/** React hook: re-renders when the plan changes. */
export function usePlan(): PlanUsage | null {
  const id = useBusinessStore((s) => s.activeBusinessId);
  const known = usePlanStore((s) => (id ? s.byBusiness[id] ?? null : null));
  return known ?? (id ? savedPlan(id) : null);
}

/** React hook: does the open branch's plan include the module? */
export function useModule(module: string | null | undefined): boolean {
  usePlan(); // subscribe
  return hasModule(module);
}

/** Has the open branch's plan been asked for (so the app may show its screens)? */
export function usePlanReady(): boolean {
  const id = useBusinessStore((s) => s.activeBusinessId);
  return usePlanStore((s) => !!id && (!!s.settled[id] || !!s.byBusiness[id]));
}

/** Name of a module for messages ("Books and accounting"). */
export function moduleName(key: string): string {
  return usePlanStore.getState().modules.find((m) => m.key === key)?.name ?? key.replace(/_/g, " ");
}

/** The cheapest public plan that includes the module (for "X is on Pro Plus"). */
export function planWithModule(key: string): PlanRow | null {
  const rows = usePlanStore.getState().catalogue.filter((p) => p.is_public && p.kind === "subscription");
  return rows.find((p) => p.modules.includes(key)) ?? null;
}

/**
 * Keeps the plan following the open branch, and fresh when the app comes back to the front.
 * Called once by the app (not at import time: the stores import each other).
 */
let watching = false;
export function startPlanWatch(): void {
  if (watching) return;
  watching = true;
  usePlanStore.getState().loadPlan().catch(() => {});
  usePlanStore.getState().loadCatalogue().catch(() => {});
  onBranchChange((id) => {
    if (id) usePlanStore.getState().loadPlan(id, true).catch(() => {});
  });
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => {
      usePlanStore.getState().loadPlan().catch(() => {});
    });
  }
}

// src/components/plan/PlanUsageCard.tsx
// Business & branches -> the company's plan: what it includes, what is used, what is locked.
// Figures come from get_plan_usage (20261204001); the database enforces every limit shown.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Lock } from "lucide-react";
import { usePlan, usePlanStore, planWithModule } from "../../stores/planStore";
import { useBusinessStore } from "../../stores/businessStore";
import { getSupabase } from "../../services/supabaseClient";
import { toUserMessage } from "../../utils/userError";
import { planNotice } from "../PlanBanner";
import { FormSheet } from "../shared/FormSheet";
import PlanChooser from "./PlanChooser";

interface PlanRequest {
  id: string;
  plan_code: string;
  billing_cycle: string;
  addons: string[];
  status: "pending" | "rejected";
  decision_note: string | null;
  payment_reference: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  trial: "Free trial",
  active: "Active",
  grace: "Payment overdue",
  read_only: "Read-only",
  suspended: "Suspended",
};

function Meter({ label, used, max, extra }: { label: string; used: number; max: number; extra?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
  const full = used >= max;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold text-app-text">{label}</span>
        <span className={`font-bold ${full ? "text-red-500" : "text-app-text"}`}>
          {used} of {max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-app-border overflow-hidden" aria-hidden>
        <div className={`h-full ${full ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
      </div>
      {extra && <span className="text-[11px] text-app-text-muted">{extra}</span>}
    </div>
  );
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function PlanUsageCard() {
  const plan = usePlan();
  const modules = usePlanStore((s) => s.modules);
  const catalogue = usePlanStore((s) => s.catalogue);
  const ref = useRef<HTMLDivElement>(null);
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const [choosing, setChoosing] = useState(false);
  const [request, setRequest] = useState<PlanRequest | null>(null);
  const [requestError, setRequestError] = useState("");

  const loadRequest = useCallback(() => {
    if (!businessId) return;
    getSupabase()
      .rpc("my_plan_request", { p_business_id: businessId })
      .then(({ data, error }) => {
        if (!error) setRequest((data as PlanRequest) ?? null);
      });
  }, [businessId]);
  useEffect(loadRequest, [loadRequest]);

  useEffect(() => {
    usePlanStore.getState().loadPlan(undefined, true).catch(() => {});
    if (!modules.length || !catalogue.length) usePlanStore.getState().loadCatalogue().catch(() => {});
    // Opened from the plan banner's "See plan".
    try {
      if (sessionStorage.getItem("kkm_business_section") === "plan") {
        sessionStorage.removeItem("kkm_business_section");
        setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
      }
    } catch {
      /* no saved section */
    }
  }, []);

  if (!plan || plan.legacy) return null;

  const notice = planNotice(plan);
  const included = modules.filter((m) => plan.modules.includes(m.key));
  const locked = modules.filter((m) => !plan.modules.includes(m.key));
  const when =
    plan.status === "trial" && plan.trial_ends_at
      ? `Trial ends ${day(plan.trial_ends_at)}`
      : plan.period_end
        ? `Paid until ${day(plan.period_end)}`
        : plan.kind === "perpetual"
          ? "Paid once, no renewal"
          : "";

  return (
    <div ref={ref} id="plan" className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm scroll-mt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-app-text font-display">
            {plan.plan_name} plan
            {plan.company_name ? <span className="text-app-text-muted font-medium"> · {plan.company_name}</span> : null}
          </h3>
          <p className="text-[11px] text-app-text-muted mt-0.5">
            {STATUS_LABEL[plan.status] ?? plan.status}
            {when ? ` · ${when}` : ""}
          </p>
        </div>
        {plan.addons.length > 0 && (
          <span className="text-[11px] font-semibold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-lg">
            Add-ons: {plan.addons.map((a) => modules.find((m) => m.key === a)?.name ?? a).join(", ")}
          </span>
        )}
      </div>

      {notice && (
        <p className={`text-[11px] font-semibold ${notice.tone === "stop" ? "text-red-500" : "text-amber-600"}`}>{notice.text}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Meter label="Branches" used={plan.branches_used} max={plan.max_branches} />
        <Meter
          label="Staff"
          used={plan.staff_used + plan.staff_pending}
          max={plan.max_staff}
          extra={`${plan.staff_pending > 0 ? `${plan.staff_pending} invited, not joined yet. ` : ""}The owner, riders and suppliers don't count.`}
        />
      </div>

      {plan.modules.includes("ai") && (
        <p className="text-[11px] text-app-text-muted">
          {plan.own_ai_key
            ? "AI assistant: your own AI key, no daily limit from us."
            : `AI assistant: up to ${plan.ai_daily_cap} questions a day for the whole business.`}
        </p>
      )}

      {included.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-app-text">Included</span>
          <div className="flex flex-wrap gap-1.5">
            {included.map((m) => (
              <span key={m.key} className="inline-flex items-center gap-1 text-[11px] text-app-text bg-app-bg border border-app-border px-2 py-0.5 rounded-lg">
                <CheckCircle2 size={11} className="text-emerald-500" aria-hidden />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {locked.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-app-text">Not in this plan</span>
          <ul className="flex flex-col gap-1">
            {locked.map((m) => {
              const on = planWithModule(m.key);
              return (
                <li key={m.key} className="flex items-start gap-1.5 text-[11px] text-app-text-muted">
                  <Lock size={11} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <span className="text-app-text">{m.name}</span>
                    {on ? ` is on ${on.name}` : ""}
                    {m.addable && catalogue.some((p) => p.addons_allowed) ? `, or an add-on on ${catalogue.find((p) => p.addons_allowed)?.name}` : ""}
                    .
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {request?.status === "pending" && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 flex flex-col gap-1 text-[11px]">
          <span className="font-semibold text-app-text flex items-center gap-1.5">
            <Clock size={12} aria-hidden /> Change to {catalogue.find((p) => p.code === request.plan_code)?.name ?? request.plan_code} is being checked
          </span>
          <span className="text-app-text-muted">
            {request.payment_reference ? `Payment code ${request.payment_reference}. ` : ""}The new plan starts when we approve it.
          </span>
          {requestError && <span className="text-red-500 font-semibold">{requestError}</span>}
          <button
            type="button"
            className="self-start font-semibold text-red-500"
            onClick={async () => {
              setRequestError("");
              const { error } = await getSupabase().rpc("cancel_signup_request", { p_request_id: request.id });
              if (error) setRequestError(toUserMessage(error, "Could not cancel the request."));
              loadRequest();
            }}
          >
            Cancel request
          </button>
        </div>
      )}
      {request?.status === "rejected" && (
        <p className="text-[11px] text-app-text-muted">
          Your last plan change was not approved.{request.decision_note ? ` ${request.decision_note}` : ""}
        </p>
      )}

      {plan.is_company_owner && request?.status !== "pending" ? (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="self-start px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-semibold"
        >
          Change plan or add a module
        </button>
      ) : !plan.is_company_owner ? (
        <p className="text-[11px] text-app-text-muted">Only the owner of the company can change its plan.</p>
      ) : null}
      <p className="text-[11px] text-app-text-muted">
        Nothing is deleted when a plan changes: locked screens come back as they were when the module is added again.
      </p>

      {choosing && businessId && (
        <FormSheet title="Your plan" onClose={() => setChoosing(false)} wide>
          <PlanChooser
            mode="change"
            businessId={businessId}
            currentPlanCode={plan.kind === "trial" ? undefined : plan.plan}
            currentAddons={plan.addons}
            onSent={() => {
              setChoosing(false);
              loadRequest();
            }}
          />
        </FormSheet>
      )}
    </div>
  );
}

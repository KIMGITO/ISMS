// src/utils/supportAccess.ts
// Platform support access (20261204007): the Owner lets platform support into one branch for a
// set time. One status per branch, shared by the banner and the Business settings card.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../services/supabaseClient";
import { SupabaseService } from "../services/supabaseService";
import { useAuthStore } from "../stores/authStore";
import { useBusinessStore } from "../stores/businessStore";
import { markBranchChosen } from "./branchChoice";

export interface SupportStatus {
  open: boolean;
  until?: string;
  reason?: string | null;
  allowed_by?: string;
  /** A platform admin has opened the branch. */
  in_use?: boolean;
  /** I am that platform support person. */
  me?: boolean;
}

const EVENT = "kkm-support-changed";

/** Tell every banner and card to read the status again. */
export function supportChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function useSupportStatus(businessId: string | null | undefined): [SupportStatus | null, () => void] {
  const [status, setStatus] = useState<SupportStatus | null>(null);
  const load = useCallback(() => {
    if (!businessId) {
      setStatus(null);
      return;
    }
    getSupabase()
      .rpc("support_status", { p_business_id: businessId })
      .then(({ data, error }) => {
        // An older database without support access: nothing to show.
        setStatus(error ? null : ((data as SupportStatus) ?? null));
      });
  }, [businessId]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    window.addEventListener(EVENT, load);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(EVENT, load);
    };
  }, [load]);

  // Read again the moment the time runs out.
  useEffect(() => {
    if (!status?.open || !status.until) return;
    const ms = new Date(status.until).getTime() - Date.now();
    if (ms <= 0) return;
    const t = window.setTimeout(load, Math.min(ms + 1000, 2_147_000_000));
    return () => window.clearTimeout(t);
  }, [status, load]);

  return [status, load];
}

export function untilText(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/** Reload who I am and which branches I can open (after support starts or ends). */
async function reloadAccess(): Promise<void> {
  await useAuthStore.getState().refreshSession();
  const list = await SupabaseService.fetchBusinesses().catch(() => null);
  if (list) useBusinessStore.getState().setBusinesses(list);
}

/** Console -> Support -> Open: the platform admin goes into the branch the Owner allowed. */
export async function openAsSupport(businessId: string): Promise<void> {
  try {
    localStorage.setItem("kkm_current_business_id_v2", businessId);
  } catch {
    /* the switch below still happens */
  }
  await reloadAccess();
  useBusinessStore.getState().setActiveBusinessId(businessId);
  const me = useAuthStore.getState().currentUser;
  if (me) markBranchChosen(businessId, me.id);
}

/** Support left or was ended: drop the branch from this session. */
export async function supportLeft(): Promise<void> {
  await reloadAccess();
}

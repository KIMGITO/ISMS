// src/utils/platformConsole.ts
// The platform console is part of the main app (SaaS step 7), but only for platform admins and
// only when they open it. While it is open no business screen shows; closing it goes back to
// the branch they had (or the branch chooser / start screen).
// The database is the real gate: every console call refuses anyone who isn't a platform admin.

import { useEffect, useState } from 'react';
import { getSupabase } from '../services/supabaseClient';

const KEY = 'kkm_platform_console';
const EVENT = 'kkm-platform-console';

export function isConsoleOpen(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setConsoleOpen(open: boolean): void {
  try {
    if (open) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the event below still switches the view */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useConsoleOpen(): boolean {
  const [open, setOpen] = useState(isConsoleOpen);
  useEffect(() => {
    const on = () => setOpen(isConsoleOpen());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return open;
}

/** Answers per signed-in account, asked once per app run. */
const answers = new Map<string, boolean>();

/** Is this person a platform admin? (false until the server says yes) */
export function usePlatformAdmin(userId: string | null | undefined): boolean {
  const [yes, setYes] = useState(() => (userId ? answers.get(userId) ?? false : false));
  useEffect(() => {
    if (!userId) {
      setYes(false);
      return;
    }
    if (answers.has(userId)) {
      setYes(answers.get(userId)!);
      return;
    }
    let live = true;
    getSupabase()
      .rpc('is_platform_admin')
      .then(({ data, error }) => {
        const v = !error && data === true;
        answers.set(userId, v);
        if (live) setYes(v);
      });
    return () => {
      live = false;
    };
  }, [userId]);
  return yes;
}

/** Forget the cached answer, e.g. after claiming the admin role. */
export function forgetPlatformAdmin(userId: string): void {
  answers.delete(userId);
}

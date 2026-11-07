// src/services/offline/salesOutbox.ts
// Sales made while offline wait here, on the device, until they reach the server.
//
// Kept in localStorage so they survive the app being closed or the phone restarting.
// Each sale carries a reference_id, and the database refuses a second sale with the
// same one, so sending a sale again after a dropped connection never counts it twice.

import type { Transaction } from "../../types";
import { SupabaseService } from "../supabaseService";

const STORAGE_KEY = "kaykays.offline.sales.v1";

export interface QueuedSale {
  tx: Transaction;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface FlushResult {
  synced: Array<{ queued: Transaction; saved: any }>;
  failed: number;
  remaining: number;
}

type Listener = (queue: QueuedSale[]) => void;
const listeners = new Set<Listener>();
let flushing: Promise<FlushResult> | null = null;

function read(): QueuedSale[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(queue: QueuedSale[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    // Storage full or blocked: the sale would be lost on restart, so say so loudly.
    console.error("[salesOutbox] Could not save the offline sales queue:", err);
  }
  listeners.forEach((fn) => fn(queue));
}

/** True when an error means "couldn't reach the server", as opposed to the server refusing. */
export function isNetworkError(err: any): boolean {
  // Only an explicit "offline": some environments leave onLine undefined
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const text = `${err?.message || ""} ${err?.name || ""}`.toLowerCase();
  return /failed to fetch|network|load failed|timeout|timed out|fetch error|offline/.test(text);
}

export const salesOutbox = {
  list(): QueuedSale[] {
    return read();
  },

  count(): number {
    return read().length;
  },

  /** Adds a sale to the queue (once per reference). */
  add(tx: Transaction): void {
    const queue = read();
    if (queue.some((q) => q.tx.referenceId === tx.referenceId)) return;
    write([...queue, { tx: { ...tx, status: "Offline_Pending" }, queuedAt: new Date().toISOString(), attempts: 0 }]);
  },

  /** Calls `fn` now and on every change. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(read());
    return () => listeners.delete(fn);
  },

  /**
   * Sends queued sales to the server, oldest first. Stops at the first network failure
   * (the rest will fail too); a sale the server refuses stays queued with its error
   * so nothing is silently dropped. Concurrent calls share one run.
   */
  flush(): Promise<FlushResult> {
    if (flushing) return flushing;
    flushing = (async () => {
      const result: FlushResult = { synced: [], failed: 0, remaining: 0 };
      for (const entry of read()) {
        try {
          const saved = await SupabaseService.syncOfflineSale(entry.tx);
          write(read().filter((q) => q.tx.referenceId !== entry.tx.referenceId));
          result.synced.push({ queued: entry.tx, saved });
        } catch (err: any) {
          result.failed++;
          write(
            read().map((q) =>
              q.tx.referenceId === entry.tx.referenceId
                ? { ...q, attempts: q.attempts + 1, lastError: String(err?.message || err).slice(0, 200) }
                : q,
            ),
          );
          if (isNetworkError(err)) break;
        }
      }
      result.remaining = read().length;
      return result;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  },
};

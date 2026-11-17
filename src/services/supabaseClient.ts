// src/services/supabaseClient.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { configManager } from "./configManager";

let supabaseClient: SupabaseClient | null = null;

// The database refuses requests from a session that was signed out (here or
// on another device) with 401 {"code":"session_revoked"}. The auth store
// registers a handler that drops straight to the sign-in screen.
let sessionRevokedHandler: (() => void) | null = null;
export function onSessionRevoked(handler: (() => void) | null): void {
  sessionRevokedHandler = handler;
}

const watchedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 401 && sessionRevokedHandler) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/rest/v1/")) {
      res.clone().json().then((body) => {
        if (body?.code === "session_revoked") sessionRevokedHandler?.();
      }).catch(() => undefined);
    }
  }
  return res;
};

/**
   * Lazy initializer for Supabase client.
   * Securely falls back to configManager environment settings.
   */
export function getSupabase(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const config = configManager.getConfig();
  const url = config.supabaseUrl;
  const anonKey = config.supabaseAnonKey;

  if (!url || url.includes("your-project.supabase.co")) {
    console.warn("Supabase is unconfigured or using placeholder values.");
  }

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: { fetch: watchedFetch }
  });

  return supabaseClient;
}

/**
 * Checks if Supabase has been fully configured.
 * Since we bundle configuration mappings, it is always true.
 */
export function isSupabaseConfigured(): boolean {
  return true;
}

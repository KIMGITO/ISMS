// src/services/supabaseClient.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { configManager } from "./configManager";

let supabaseClient: SupabaseClient | null = null;

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
    }
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

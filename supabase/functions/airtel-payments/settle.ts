// supabase/functions/airtel-payments/settle.ts
// Reads a business's Airtel keys and settles a prompt from Airtel's own answer.
// Used by airtel-payments (the app checking) and airtel-callback (Airtel calling).

// deno-lint-ignore-file no-explicit-any
import { enquire, type AirtelKeys } from "./airtel.ts";

type Admin = any;

/** The business's Airtel keys, or null when Airtel isn't set up. */
export async function keysFor(admin: Admin, businessId: string): Promise<AirtelKeys | null> {
  const [{ data: secret }, { data: settings }] = await Promise.all([
    admin.from("airtel_payment_secrets").select("client_id, client_secret").eq("business_id", businessId).maybeSingle(),
    admin.from("airtel_payment_settings").select("environment, country, currency").eq("business_id", businessId).maybeSingle(),
  ]);
  if (!secret || !settings) return null;
  return {
    clientId: secret.client_id,
    clientSecret: secret.client_secret,
    environment: settings.environment,
    country: settings.country,
    currency: settings.currency,
  };
}

/** Asks Airtel about a pending prompt and applies a final answer. Returns the row's status. */
export async function refreshPrompt(admin: Admin, row: any): Promise<string> {
  if (row.status !== "Pending") return row.status;
  const keys = await keysFor(admin, row.business_id);
  if (!keys) return row.status;
  const result = await enquire(keys, row.reference);
  if (result.outcome === "pending") {
    if (result.message && result.message !== row.result_message) {
      await admin.from("airtel_transactions")
        .update({ result_code: result.code, result_message: result.message, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", "Pending");
    }
    return "Pending";
  }
  const { error } = await admin.rpc("confirm_airtel_payment", {
    p_reference: row.reference,
    p_success: result.outcome === "success",
    p_airtel_money_id: result.airtelMoneyId,
    p_code: result.code,
    p_message: result.message,
    p_raw: { source: "enquiry", ...result },
  });
  if (error) throw error;
  return result.outcome === "success" ? "Completed" : "Failed";
}

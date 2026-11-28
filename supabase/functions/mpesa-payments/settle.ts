// supabase/functions/mpesa-payments/settle.ts
// Shared by mpesa-payments (staff "check" and "test_till") and payment-sweep (every 2 minutes).
//
// Safaricom's callback is the normal way a result arrives, but callbacks can be lost. So a prompt
// whose callback is overdue is settled from Safaricom's status query. The query has no receipt
// number, so a paid prompt is recorded with a stand-in "QRY-<checkout id>"; if the real callback
// arrives later, confirm_store_payment_request swaps in the real receipt (20261212008).

// deno-lint-ignore-file no-explicit-any
import { DarajaKeys, registerC2bUrls, stkQuery } from "../customer-checkout/daraja.ts";

/** A paid query result is final, so it is recorded once the callback is a minute late. */
export const PAID_GRACE_SECONDS = 60;
/** A failed query result waits longer, so a slow callback can't be judged "not paid" too early. */
export const FAILED_GRACE_SECONDS = 180;

export interface PromptRow {
  checkout_request_id: string;
  created_at: string;
  amount: number | string;
  online_order_id?: string | null;
}

export interface SettleResult {
  status: "Pending" | "Completed" | "Failed";
  paid?: boolean;
  resultCode?: number;
}

export async function settlePrompt(admin: any, keys: DarajaKeys, row: PromptRow): Promise<SettleResult> {
  const code = await stkQuery(keys, row.checkout_request_id);
  if (code === null) return { status: "Pending" };
  const ageSeconds = (Date.now() - new Date(row.created_at).getTime()) / 1000;
  const paid = code === 0;
  if (ageSeconds < (paid ? PAID_GRACE_SECONDS : FAILED_GRACE_SECONDS)) {
    return { status: "Pending", paid, resultCode: code };
  }
  const args = {
    p_checkout_request_id: row.checkout_request_id,
    p_result_code: code,
    // Code 0 means the customer paid what was asked.
    p_amount: paid ? Number(row.amount) : null,
    p_receipt: paid ? `QRY-${row.checkout_request_id}` : null,
    p_raw: { source: "status_query", resultCode: code },
  };
  let { data, error } = await admin.rpc("confirm_online_order_payment", args);
  if (error) throw error;
  if (data === "unknown") {
    ({ data, error } = await admin.rpc("confirm_store_payment_request", args));
    if (error) throw error;
  }
  console.log(`[settle] ${row.checkout_request_id}: query ${code} -> ${data}`);
  return { status: paid ? "Completed" : "Failed", resultCode: code };
}

/** Where Safaricom sends till payments (the function name must not contain "mpesa"). */
export function tillCallbackUrls(callbackToken: string): { confirmation: string; validation: string; ping: string } {
  const base = Deno.env.get("MPESA_C2B_CALLBACK_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/till-callback`;
  const withToken = (type: string) => `${base}?type=${type}&token=${encodeURIComponent(callbackToken)}`;
  return { confirmation: withToken("confirmation"), validation: withToken("validation"), ping: withToken("ping") };
}

/** True when our own callback address answers over HTTPS with its token accepted (type=ping). */
export async function pingCallbackUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(10_000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/** Registers the till's callback URLs with Safaricom and notes when. */
export async function registerTill(
  admin: any,
  keys: DarajaKeys,
  tillNumber: string,
  by: string,
): Promise<{ ok: boolean; detail: string; duplicate?: boolean }> {
  const urls = tillCallbackUrls(keys.callbackToken);
  const result = await registerC2bUrls(keys, tillNumber, urls.confirmation, urls.validation);
  if (!result.ok) return result;
  const now = new Date().toISOString();
  await admin.from("mpesa_settings").upsert({
    business_id: keys.businessId,
    registered_at: now,
    updated_by: by,
    updated_at: now,
  });
  return result;
}

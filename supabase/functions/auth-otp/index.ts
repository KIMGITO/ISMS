// supabase/functions/auth-otp/index.ts
// Server-only OTP lifecycle for email verification and password recovery.
// Codes are generated, stored and checked here and are never returned to the client.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse, enforceRateLimit } from "../shared/cors.ts";

const OTP_TYPES = ["signup", "password_reset"];
const MIN_PASSWORD_LENGTH = 8;
const INVALID_CODE = "Invalid or expired code. Please check it or request a new one.";

function generateOtp(): string {
  // Rejection sampling keeps all 900000 codes equally likely.
  const limit = Math.floor(0xffffffff / 900000) * 900000;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return String(100000 + (buf[0] % 900000));
}

async function dispatchEmail(to: string, type: string, variables: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ to, type, variables, user: true }),
  });
  if (!res.ok) throw new Error(`send-email responded with ${res.status}`);
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid request.", 400);
    }

    const { action, type, code, password } = body;
    const email = String(body.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return errorResponse("Please enter a valid email address.", 400);
    }

    // Per-code guess limits live in otp_check. This stops one source probing many accounts.
    const clientIp = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    const limited =
      (await enforceRateLimit(`otp:ip:${clientIp}`, 30, 600)) ||
      (await enforceRateLimit(`otp:email:${email}`, 15, 3600));
    if (limited) return limited;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const checkCode = async (otpType: string, consume: boolean): Promise<boolean> => {
      const { data, error } = await supabase.rpc("otp_check", {
        p_email: email,
        p_type: otpType,
        p_code: String(code || ""),
        p_consume: consume,
      });
      if (error) throw error;
      return data === true;
    };

    // ── SEND ─────────────────────────────────────────────────────────────
    // Responds the same whether or not the account exists, so emails can't be enumerated.
    if (action === "send") {
      if (!OTP_TYPES.includes(type)) return errorResponse("Invalid request.", 400);

      const { data: found, error: lookupErr } = await supabase.rpc("otp_lookup_user", { p_email: email });
      if (lookupErr) throw lookupErr;
      const account = Array.isArray(found) ? found[0] : found;
      if (!account) return jsonResponse({ success: true });

      const otp = generateOtp();
      const { data: issued, error: issueErr } = await supabase.rpc("otp_issue", {
        p_email: email,
        p_type: type,
        p_code: otp,
      });
      if (issueErr) throw issueErr;
      if (!issued) return jsonResponse({ success: true });

      await dispatchEmail(email, type === "signup" ? "verification_code" : "password_reset", {
        code: otp,
        name: String(body.name || "").trim() || account.user_name || "User",
      });
      return jsonResponse({ success: true });
    }

    // ── VERIFY SIGNUP ────────────────────────────────────────────────────
    if (action === "verify_signup") {
      if (!(await checkCode("signup", true))) {
        return jsonResponse({ success: false, error: INVALID_CODE });
      }

      const { error: confirmErr } = await supabase.rpc("otp_confirm_signup", { p_email: email });
      if (confirmErr) throw confirmErr;

      const { data: found } = await supabase.rpc("otp_lookup_user", { p_email: email });
      const account = Array.isArray(found) ? found[0] : found;
      dispatchEmail(email, "welcome", { name: account?.user_name || "User" }).catch((e) =>
        console.error("[auth-otp] welcome email failed:", e)
      );
      return jsonResponse({ success: true });
    }

    // ── VERIFY RESET ─────────────────────────────────────────────────────
    // Keeps the code valid so that reset_password can re-check it in the next step.
    if (action === "verify_reset") {
      const valid = await checkCode("password_reset", false);
      return jsonResponse(valid ? { success: true } : { success: false, error: INVALID_CODE });
    }

    // ── RESET PASSWORD ───────────────────────────────────────────────────
    if (action === "reset_password") {
      if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse({
          success: false,
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
        });
      }
      if (!(await checkCode("password_reset", false))) {
        return jsonResponse({ success: false, error: INVALID_CODE });
      }

      const { data: found, error: lookupErr } = await supabase.rpc("otp_lookup_user", { p_email: email });
      if (lookupErr) throw lookupErr;
      const account = Array.isArray(found) ? found[0] : found;
      if (!account) return jsonResponse({ success: false, error: INVALID_CODE });

      const { error: updateErr } = await supabase.auth.admin.updateUserById(account.auth_user_id, { password });
      if (updateErr) {
        console.error("[auth-otp] password update failed:", updateErr);
        return jsonResponse({
          success: false,
          error: "This password could not be used. Please choose a different one.",
        });
      }

      await checkCode("password_reset", true);
      return jsonResponse({ success: true });
    }

    return errorResponse("Invalid request.", 400);
  } catch (err: any) {
    console.error("[auth-otp] Critical error:", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});

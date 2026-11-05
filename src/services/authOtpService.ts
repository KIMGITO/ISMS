import { getSupabase } from "./supabaseClient";
import { AppError, toUserMessage } from "../utils/userError";

type OtpResult = { success: boolean; error?: string };

/** Client for the auth-otp edge function. Codes are created and checked only on the server. */
export class AuthOtpService {
  private static async call(body: Record<string, unknown>, fallback: string): Promise<OtpResult> {
    try {
      const { data, error } = await getSupabase().functions.invoke("auth-otp", { body });
      if (error) {
        const serverMessage = await (error as any).context?.json?.().then((d: any) => d?.error).catch(() => null);
        throw serverMessage ? new AppError(serverMessage) : error;
      }
      return data?.success ? { success: true } : { success: false, error: data?.error || fallback };
    } catch (err) {
      console.error(`[AuthOtpService] ${body.action} failed:`, err);
      return { success: false, error: toUserMessage(err, fallback) };
    }
  }

  static sendSignupCode(email: string, name?: string) {
    return this.call({ action: "send", type: "signup", email, name }, "Failed to send verification code. Please try again.");
  }

  static sendPasswordResetCode(email: string) {
    return this.call({ action: "send", type: "password_reset", email }, "Failed to send recovery code. Please try again.");
  }

  static verifySignupCode(email: string, code: string) {
    return this.call({ action: "verify_signup", email, code }, "Invalid or expired verification code.");
  }

  static verifyPasswordResetCode(email: string, code: string) {
    return this.call({ action: "verify_reset", email, code }, "Invalid or expired recovery code.");
  }

  static resetPassword(email: string, code: string, password: string) {
    return this.call({ action: "reset_password", email, code, password }, "Failed to update password. Please try again.");
  }
}

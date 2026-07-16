import { getSupabase } from "./supabaseClient";

export class EmailService {
  /**
   * Invokes the send-email Supabase Edge Function with specified template and variables
   */
  public static async sendEmail(
    type: "verification_code" | "invitation" | "welcome" | "password_reset" | "ai_insight" | "report",
    to: string,
    variables: Record<string, any>
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: { to, type, variables },
      });

      if (error) {
        console.error(`Supabase invoke failed for send-email:`, error);
        throw error;
      }

      if (data && data.success === false) {
        throw new Error(data.error || "Failed to dispatch email");
      }

      return data || { success: true };
    } catch (err: any) {
      console.error(`[EmailService] error dispatching "${type}" email to ${to}:`, err);
      throw err;
    }
  }

  /**
   * Dispatches a registration email verification OTP code
   */
  public static async sendVerificationCode(to: string, code: string, name: string) {
    return this.sendEmail("verification_code", to, { code, name });
  }

  /**
   * Dispatches an invitation email to a new team member
   */
  public static async sendInvitation(
    to: string,
    code: string,
    name: string,
    businessName: string,
    role: string,
    optionalMessage?: string
  ) {
    return this.sendEmail("invitation", to, {
      code,
      name,
      businessName,
      role,
      optionalMessage
    });
  }

  /**
   * Dispatches a welcome email upon successful account verification
   */
  public static async sendWelcome(to: string, name: string) {
    return this.sendEmail("welcome", to, { name });
  }

  /**
   * Dispatches a security password reset code
   */
  public static async sendPasswordResetCode(to: string, code: string, name: string) {
    return this.sendEmail("password_reset", to, { code, name });
  }

  /**
   * Dispatches a custom AI demand warning or optimization report
   */
  public static async sendAiInsight(to: string, name: string, insightText: string, confidenceScore: number) {
    return this.sendEmail("ai_insight", to, { name, insightText, confidenceScore });
  }

  /**
   * Dispatches periodic automated business reports
   */
  public static async sendReport(to: string, name: string, reportType: string, reportData: any) {
    return this.sendEmail("report", to, { name, reportType, reportData });
  }
}

export default EmailService;

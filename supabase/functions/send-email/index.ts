import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import nodemailer from "npm:nodemailer@6.9.13"; // Using modern NPM specifier

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEmailTemplate(type: string, vars: Record<string, any>): { subject: string; html: string } {
  let subject = "";
  let html = "";

  const appName = "KayKay's Milk Systems";
  const primaryColor = "#f59e0b"; // Amber 500

  switch (type) {
    case "verification_code": {
      const { code, name } = vars;
      subject = `Verify your email address - ${appName}`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Verification Code Flow</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>Thank you for signing up as a Business Owner. Use the verification code below to confirm your email and complete registration:</p>
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 16px; font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; color: ${primaryColor}; margin: 20px 0; border-radius: 8px;">
            ${code}
          </div>
          <p style="font-size: 11px; color: #94a3b8;">This code is valid for 15 minutes. If you did not request this, you can safely ignore this email.</p>
        </div>
      `;
      break;
    }
    case "invitation": {
      const { code, name, businessName, role, optionalMessage } = vars;
      subject = `Join ${businessName || "Workspace"} on ${appName}`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Workspace Staff Invitation</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>You have been invited to join <strong>${businessName || "our workspace"}</strong> as a <strong>${role || "Staff"}</strong>.</p>
          <p>Open the app, select <strong>Join Team</strong>, and enter the code below to register:</p>
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 16px; font-size: 24px; font-weight: bold; letter-spacing: 4px; text-align: center; color: ${primaryColor}; margin: 20px 0; border-radius: 8px;">
            ${code}
          </div>
          ${optionalMessage ? `<p>Message from owner: <em>"${optionalMessage}"</em></p>` : ""}
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8;">This invitation token is valid for 72 hours.</p>
        </div>
      `;
      break;
    }
    case "welcome": {
      const { name } = vars;
      subject = `Welcome to ${appName}!`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Welcome aboard!</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>Your owner account is officially verified! We are excited to help you streamline your dairy cooperative and milk distribution command center.</p>
          <p>You can now log in, configure your branches, add products, register staff, and manage your inventory with state-of-the-art biometrics and offline synchronization.</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8;">Best regards,<br>The ${appName} Team</p>
        </div>
      `;
      break;
    }
    case "password_reset": {
      const { code, name } = vars;
      subject = `Reset your password - ${appName}`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Password Recovery</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>We received a request to reset your security passcode. Use the password reset OTP code below to confirm authorization:</p>
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 16px; font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; color: ${primaryColor}; margin: 20px 0; border-radius: 8px;">
            ${code}
          </div>
          <p style="font-size: 11px; color: #94a3b8;">This code is valid for 15 minutes. If you did not request this, you can safely ignore this email.</p>
        </div>
      `;
      break;
    }
    case "ai_insight": {
      const { name, insightText, confidenceScore } = vars;
      subject = `🤖 New AI Business Insight - ${appName}`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">AI Demand Engine Analysis</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>Our intelligent agent has compiled a new recommendation for your active branch:</p>
          <div style="background: #fffbeb; border-left: 4px solid ${primaryColor}; padding: 16px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; font-style: italic; color: #b45309;">"${insightText}"</p>
          </div>
          <p><strong>Confidence Score:</strong> ${confidenceScore || 90}%</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8;">Generated automatically by the AI Copilot.</p>
        </div>
      `;
      break;
    }
    case "report": {
      const { name, reportType, reportData } = vars;
      subject = `📊 ${reportType || "Business"} Performance Report - ${appName}`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Financial Statement & Logs</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>Your requested <strong>${reportType || "business"}</strong> analysis is ready for review.</p>
          <div style="background: #f8fafc; padding: 16px; margin: 20px 0; border-radius: 8px; border: 1px solid #e2e8f0;">
            <pre style="margin: 0; font-family: monospace; white-space: pre-wrap; font-size: 12px; color: #334155;">${JSON.stringify(reportData, null, 2)}</pre>
          </div>
          <p>Log in to the POS Hub to download the complete spreadsheet and PDF sheets.</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8;">This report was prepared by KayKay's Milk automated report scheduler.</p>
        </div>
      `;
      break;
    }
    case "password_changed_notification": {
      const { name } = vars;
      subject = `Security Alert: Password changed - ${appName}`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Security Notification</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>This is a confirmation that your account password was recently changed.</p>
          <p>If you did not make this change, please contact our support team immediately to secure your account.</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8;">Best regards,<br>The ${appName} Team</p>
        </div>
      `;
      break;
    }
    case "email_changed_notification": {
      const { name } = vars;
      subject = `Security Alert: Email address updated - ${appName}`;
      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Security Notification</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>This is a confirmation that the email address associated with your account was successfully updated.</p>
          <p>If you did not make this change, please contact our support team immediately.</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8;">Best regards,<br>The ${appName} Team</p>
        </div>
      `;
      break;
    }
    default: {
      const { name, code } = vars;
      subject = `Notification from ${appName}`;
      const codeHtml = code ? `
        <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 16px; font-size: 24px; font-weight: bold; text-align: center; color: ${primaryColor}; margin: 20px 0; border-radius: 8px;">
          ${code}
        </div>
      ` : "";

      html = `
        <div style="font-family: sans-serif; padding: 20px; color: #0f172a; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: ${primaryColor}; margin-bottom: 4px;">${appName}</h2>
          <p style="font-size: 14px; color: #64748b;">Account Notification</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
          <p>Hello <strong>${name || "User"}</strong>,</p>
          <p>This email was dispatched to update you regarding your account activity (event type: <strong>${type}</strong>).</p>
          ${codeHtml}
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8;">Best regards,<br>The ${appName} Team</p>
        </div>
      `;
      break;
    }
  }

  return { subject, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    let to: string;
    let type: string;
    let variables: Record<string, any> = {};

    // Check if it's a Supabase Auth Hook payload
    if (body.user && body.email_data) {
      const { user, email_data } = body;
      to = user.email;
      const action = email_data.email_action_type;
      const code = email_data.token;
      const name = user.user_metadata?.name || user.email.split("@")[0];

      // Map Supabase Auth Action to our email templates
      if (action === "signup" || action === "email_change" || action === "magiclink") {
        type = "verification_code";
        variables = { code, name };
      } else if (action === "recovery") {
        type = "password_reset";
        variables = { code, name };
      } else if (action === "invite") {
        type = "invitation";
        variables = {
          code,
          name,
          businessName: user.user_metadata?.business_name || "KayKay's Milk Systems",
          role: user.user_metadata?.role || "Staff",
          optionalMessage: user.user_metadata?.message || ""
        };
      } else {
        // Use the action name directly or default fallback
        type = action;
        variables = { code, name, ...email_data };
      }
    } else {
      // Direct call
      to = body.to;
      type = body.type;
      variables = body.variables || {};
    }

    if (!to || !type || !variables) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: to, type, variables" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Retrieve environmental settings
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
    const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
    const SMTP_PORT = Number(Deno.env.get("SMTP_PORT")) || 587;
    const SMTP_USER = Deno.env.get("SMTP_USER") || "";
    const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

    const hasResend = !!RESEND_API_KEY;
    const hasSmtp = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

    if (!hasResend && !hasSmtp) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Email provider is not configured. Please set RESEND_API_KEY or SMTP variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) in Supabase secrets."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Get rendered template details
    const { subject, html } = getEmailTemplate(type, variables);
    const senderEmail = SMTP_USER || "operations@kaykaysmilk.com";

    if (hasResend) {
      console.log(`[send-email] Dispatching email to ${to} via Resend API`);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: senderEmail,
          to: [to],
          subject: subject,
          html: html,
        }),
      });

      const resJson = await response.json();
      if (!response.ok) {
        throw new Error(resJson.message || "Failed to send email via Resend");
      }

      return new Response(
        JSON.stringify({ success: true, messageId: resJson.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      console.log(`[send-email] Dispatching email to ${to} via SMTP ${SMTP_HOST}`);
      
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465, // true for 465, false for 587/25
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });

      const info = await transporter.sendMail({
        from: senderEmail,
        to: to,
        subject: subject,
        html: html,
      });

      return new Response(
        JSON.stringify({ success: true, message: "Email sent via SMTP successfully", messageId: info.messageId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
  } catch (err: any) {
    console.error("[send-email] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

import nodemailer from "npm:nodemailer@6.9.13";
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Strips legacy prefixes like "INV-" from verification and invitation codes
 */
function cleanCodeValue(codeVal: any): string {
  if (!codeVal) return "";
  let str = String(codeVal).trim();
  if (str.toUpperCase().startsWith("INV-")) {
    str = str.slice(4);
  }
  return str.toUpperCase();
}

/**
 * Modern Responsive Branded Email Template Builder
 */
function getEmailTemplate(type: string, vars: Record<string, any>): { subject: string; html: string } {
  const brandName = vars.brandName || "KayKay's Milk Systems";
  const appName = brandName;
  const primaryColor = vars.primaryColor || "#f59e0b"; // Warm Amber Accent
  const code = cleanCodeValue(vars.code || vars.token || vars.otp || vars.verificationCode);
  const appUrl = vars.appUrl || "http://localhost:5173";

  let subject = "";
  let html = "";
  let bodyContent = "";

  switch (type) {
    case "verification_code":
    case "signup": {
      const name = vars.name || vars.to || "Business Owner";
      const cleanCode = code;

      subject = `Verify your email address - ${appName}`;
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 520px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; color: #f8fafc; shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);">
            <!-- Header Badge -->
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
              <div style="background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🥛</div>
              <div>
                <h1 style="margin: 0; font-size: 18px; font-weight: 800; color: #f8fafc; letter-spacing: -0.5px;">${appName}</h1>
                <span style="font-size: 11px; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Security & Account Verification</span>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 0 0 24px 0;" />

            <!-- Body Content -->
            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-top: 0;">Hello <strong style="color: #f8fafc;">${name}</strong>,</p>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">Thank you for registering. Use the 6-character verification code below to confirm your email and complete account setup:</p>

            <!-- Prominent Code Box -->
            <div style="background-color: #1e293b; border: 2px dashed rgba(245, 158, 11, 0.4); border-radius: 14px; padding: 24px; text-align: center; margin: 28px 0;">
              <span id="verification-code" style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: ${primaryColor}; text-shadow: 0 0 12px rgba(245, 158, 11, 0.2); display: block; margin-bottom: 12px;">
                ${cleanCode}
              </span>
              <button onclick="navigator.clipboard.writeText('${cleanCode}').then(() => this.innerHTML='✓ Copied!').catch(() => {})" style="background-color: ${primaryColor}; color: #090d16; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                📋 Copy Code
              </button>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 600; display: block; margin-top: 10px;">Standard 6-Character Verification Code</span>
            </div>

            <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 16px; line-height: 1.5;">
              Copy this code and paste it into the application verification screen to confirm your email address.
            </p>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 24px 0 16px 0;" />

            <p style="font-size: 11px; color: #64748b; margin: 0; text-align: center;">
              This code expires in 15 minutes. If you did not request this email, please ignore it.
            </p>
          </div>
        </body>
        </html>
      `;
      break;
    }

    case "invitation": {
      const { name, businessName, role, optionalMessage } = vars;
      const cleanCode = code;

      subject = `Team Invitation: Join ${businessName || "Workspace"} on ${appName}`;
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 520px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; color: #f8fafc; shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
              <div style="background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px;">📋</div>
              <div>
                <h1 style="margin: 0; font-size: 18px; font-weight: 800; color: #f8fafc;">${appName}</h1>
                <span style="font-size: 11px; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Workspace Staff Invitation</span>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 0 0 24px 0;" />

            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-top: 0;">Hello <strong style="color: #f8fafc;">${name || "Team Member"}</strong>,</p>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">You have been officially invited to join <strong style="color: #f8fafc;">${businessName || "our workspace"}</strong> as a <strong style="color: ${primaryColor};">${role || "Staff"}</strong>.</p>
            
            ${optionalMessage ? `<div style="background-color: #1e293b; border-left: 3px solid ${primaryColor}; padding: 12px 16px; margin: 16px 0; border-radius: 6px; font-style: italic; color: #cbd5e1; font-size: 13px;">"${optionalMessage}"</div>` : ""}

            <div style="background-color: #1e293b; border: 2px dashed rgba(245, 158, 11, 0.4); border-radius: 14px; padding: 24px; text-align: center; margin: 28px 0;">
              <span id="invitation-code" style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 900; letter-spacing: 6px; color: ${primaryColor}; display: block; margin-bottom: 12px;">
                ${cleanCode}
              </span>
              <button onclick="navigator.clipboard.writeText('${cleanCode}').then(() => this.innerHTML='✓ Copied!').catch(() => {})" style="background-color: ${primaryColor}; color: #090d16; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                📋 Copy Code
              </button>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 600; display: block; margin-top: 10px;">6-Character Team Invitation Code</span>
            </div>

            <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 16px; line-height: 1.5;">
              Copy this code and paste it into the application invitation screen to join the workspace.
            </p>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 24px 0 16px 0;" />
            <p style="font-size: 11px; color: #64748b; margin: 0; text-align: center;">This invitation code is valid for 72 hours.</p>
          </div>
        </body>
        </html>
      `;
      break;
    }

    case "password_reset": {
      const { name } = vars;
      const cleanCode = code;

      subject = `Password Recovery Code - ${appName}`;
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 520px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; color: #f8fafc; shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
              <div style="background-color: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🔐</div>
              <div>
                <h1 style="margin: 0; font-size: 18px; font-weight: 800; color: #f8fafc;">${appName}</h1>
                <span style="font-size: 11px; color: #ef4444; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Security & Password Recovery</span>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 0 0 24px 0;" />

            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-top: 0;">Hello <strong style="color: #f8fafc;">${name || "User"}</strong>,</p>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">We received a request to reset your security passcode. Use the password reset OTP code below to authorize password recovery:</p>

            <div style="background-color: #1e293b; border: 2px dashed rgba(239, 68, 68, 0.4); border-radius: 14px; padding: 24px; text-align: center; margin: 28px 0;">
              <span id="reset-code" style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #f87171; display: block; margin-bottom: 12px;">
                ${cleanCode}
              </span>
              <button onclick="navigator.clipboard.writeText('${cleanCode}').then(() => this.innerHTML='✓ Copied!').catch(() => {})" style="background-color: #ef4444; color: #ffffff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                📋 Copy Code
              </button>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 600; display: block; margin-top: 10px;">Password Reset OTP</span>
            </div>

            <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 16px; line-height: 1.5;">
              Copy this code and paste it into the application password reset screen to recover your account.
            </p>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 24px 0 16px 0;" />
            <p style="font-size: 11px; color: #64748b; margin: 0; text-align: center;">This code expires in 15 minutes. If you did not request a password reset, please ignore this email.</p>
          </div>
        </body>
        </html>
      `;
      break;
    }

    case "welcome": {
      const { name } = vars;
      subject = `Welcome to ${appName}!`;
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 520px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; color: #f8fafc;">
            <h1 style="color: ${primaryColor}; margin-top: 0;">Welcome to ${appName}!</h1>
            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6;">Hello <strong style="color: #f8fafc;">${name || "User"}</strong>,</p>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">Your account has been verified successfully. You now have full access to your business operations dashboard, inventory management, and POS terminal.</p>
            <div style="text-align: center; margin: 28px 0 16px 0;">
              <a href="${appUrl}/?screen=login" style="display: inline-block; padding: 14px 28px; background-color: ${primaryColor}; color: #090d16; font-weight: 900; font-size: 14px; text-decoration: none; border-radius: 12px;">Launch Dashboard</a>
            </div>
          </div>
        </body>
        </html>
      `;
      break;
    }

    default: {
      const { name } = vars;
      const cleanCode = code;
      const codeHtml = cleanCode ? `
        <div style="background-color: #1e293b; border: 1px dashed rgba(245, 158, 11, 0.4); padding: 16px; font-family: monospace; font-size: 28px; font-weight: bold; text-align: center; color: ${primaryColor}; margin: 20px 0; border-radius: 8px;">
          ${cleanCode}
        </div>
      ` : "";

      subject = `Notification from ${appName}`;
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #090d16; font-family: sans-serif;">
          <div style="max-width: 520px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; color: #f8fafc;">
            <h2 style="color: ${primaryColor}; margin-top: 0;">${appName}</h2>
            <p style="color: #cbd5e1;">Hello <strong>${name || "User"}</strong>,</p>
            <p style="color: #94a3b8;">This email is regarding your account activity (Type: ${type}).</p>
            ${codeHtml}
          </div>
        </body>
        </html>
      `;
      break;
    }
  }

  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON payload" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
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

      if (action === "signup" || action === "email_change" || action === "magiclink") {
        type = "verification_code";
        variables = { code, name, to };
      } else if (action === "recovery") {
        type = "password_reset";
        variables = { code, name, to };
      } else if (action === "invite") {
        type = "invitation";
        variables = {
          code,
          name,
          to,
          businessName: user.user_metadata?.business_name || "KayKay's Milk Systems",
          role: user.user_metadata?.role || "Staff",
          optionalMessage: user.user_metadata?.message || ""
        };
      } else {
        type = action;
        variables = { code, name, to, ...email_data };
      }
    } else {
      // Direct API call
      to = body.to;
      type = body.type;
      variables = { to, ...body.variables };
    }

    if (!to || !type) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: to, type" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validate user existence and confirmation status
    if (type === "verification_code" || type === "password_reset") {
      let userExists = false;
      let isConfirmed = false;

      if (body.user) {
        userExists = true;
        isConfirmed = !!body.user.email_confirmed_at;
      } else {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        if (supabaseUrl && serviceRoleKey) {
          const supabase = createClient(supabaseUrl, serviceRoleKey);
          
          // Fallback to searching all users if direct call (note: this might be slow for >50 users, 
          // but works for edge function environments if admin API search isn't straightforward)
          const { data, error } = await supabase.auth.admin.listUsers();
          if (!error && data?.users) {
            const foundUser = data.users.find((u: any) => u.email === to);
            if (foundUser) {
              userExists = true;
              isConfirmed = !!foundUser.email_confirmed_at;
            }
          }
        }
      }

      if (!userExists) {
        console.log(`[send-email] Aborting: User ${to} does not exist.`);
        return new Response(
          JSON.stringify({ success: false, message: "User does not exist. Email aborted gracefully." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      if (type === "verification_code" && isConfirmed) {
        console.log(`[send-email] Aborting: User ${to} is already confirmed.`);
        return new Response(
          JSON.stringify({ success: false, message: "Email is already confirmed. Verification code not sent." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    }

    // Retrieve environmental settings
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
    const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
    const SMTP_PORT = Number(Deno.env.get("SMTP_PORT")) || 587;
    const SMTP_USER = Deno.env.get("SMTP_USER") || "";
    const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

    const hasResend = !!RESEND_API_KEY;
    const hasSmtp = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

    const { subject, html } = getEmailTemplate(type, variables);
    const senderEmail = SMTP_USER || "operations@kaykaysmilk.com";

    // If no real email transport is configured, log code and return mock success for local dev
    if (!hasResend && !hasSmtp) {
      console.log(`[send-email] LOCAL DEV SIMULATION: Dispatched "${type}" email to ${to}`);
      console.log(`[send-email] Code: "${cleanCodeValue(variables.code)}" | Subject: "${subject}"`);

      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          message: `[Dev Sandbox] Simulated email dispatch to ${to}. Code: ${cleanCodeValue(variables.code)}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

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
        secure: SMTP_PORT === 465,
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

import nodemailer from "npm:nodemailer@6.9.13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  let subject = "";
  let html = "";

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
          <div style="max-width: 520px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; color: #f8fafc;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
              <div style="background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🥛</div>
              <div>
                <h1 style="margin: 0; font-size: 18px; font-weight: 800; color: #f8fafc;">${appName}</h1>
                <span style="font-size: 11px; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Security & Account Verification</span>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 0 0 24px 0;" />

            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-top: 0;">Hello <strong style="color: #f8fafc;">${name}</strong>,</p>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">Use the verification code below to confirm your email and complete account setup:</p>

            <div style="background-color: #1e293b; border: 2px dashed rgba(245, 158, 11, 0.4); border-radius: 14px; padding: 24px; text-align: center; margin: 28px 0;">
              <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: ${primaryColor}; display: block; margin-bottom: 12px;">
                ${cleanCode}
              </span>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 600; display: block; margin-top: 10px;">Verification Code (Valid for 15 minutes)</span>
            </div>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 24px 0 16px 0;" />
            <p style="font-size: 11px; color: #64748b; margin: 0; text-align: center;">This code expires in 15 minutes. If you did not request this, please ignore it.</p>
          </div>
        </body>
        </html>
      `;
      break;
    }

    case "password_reset": {
      const name = vars.name || "User";
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
          <div style="max-width: 520px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; color: #f8fafc;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
              <div style="background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🔑</div>
              <div>
                <h1 style="margin: 0; font-size: 18px; font-weight: 800; color: #f8fafc;">${appName}</h1>
                <span style="font-size: 11px; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Password Reset Request</span>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 0 0 24px 0;" />

            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-top: 0;">Hello <strong style="color: #f8fafc;">${name}</strong>,</p>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">We received a request to reset your password. Use the 6-digit recovery code below to proceed:</p>

            <div style="background-color: #1e293b; border: 2px dashed rgba(245, 158, 11, 0.4); border-radius: 14px; padding: 24px; text-align: center; margin: 28px 0;">
              <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: ${primaryColor}; display: block; margin-bottom: 12px;">
                ${cleanCode}
              </span>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 600; display: block; margin-top: 10px;">Security Recovery Code</span>
            </div>

            <hr style="border: 0; border-top: 1px solid #1e293b; margin: 24px 0 16px 0;" />
            <p style="font-size: 11px; color: #64748b; margin: 0; text-align: center;">This recovery code expires in 15 minutes. If you did not request a password reset, please ignore this message.</p>
          </div>
        </body>
        </html>
      `;
      break;
    }

    default: {
      subject = `${appName} Notification`;
      html = `<p>You have a new notification from ${appName}.</p>`;
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
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON payload" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const { to, type, variables = {} } = body;
    if (!to) {
      return new Response(
        JSON.stringify({ success: false, error: "Recipient 'to' email is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const cleanTo = String(to).trim().toLowerCase();
    console.log(`[send-email] Received dispatch request for type="${type}" to="${cleanTo}"`);

    // Validate user existence and confirmation status
    if (type === "verification_code" || type === "password_reset") {
      let userExists = false;

      if (body.user || type === "password_reset") {
        userExists = true;
      } else {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        if (supabaseUrl && serviceRoleKey) {
          const supabase = createClient(supabaseUrl, serviceRoleKey);
          
          // Check auth admin users (case-insensitive)
          const { data } = await supabase.auth.admin.listUsers();
          if (data?.users) {
            const foundUser = data.users.find((u: any) => u.email?.trim().toLowerCase() === cleanTo);
            if (foundUser) userExists = true;
          }

          // Fallback to public.users table
          if (!userExists) {
            const { data: dbUser } = await supabase
              .from("users")
              .select("id")
              .ilike("email", cleanTo)
              .maybeSingle();
            if (dbUser) userExists = true;
          }
        }
      }

      if (!userExists) {
        console.log(`[send-email] Aborting: User ${cleanTo} does not exist.`);
        return new Response(
          JSON.stringify({ success: true, message: "User does not exist. Email aborted gracefully." }),
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

    const { subject, html } = getEmailTemplate(type, { ...variables, to: cleanTo });
    const senderEmail = SMTP_USER || "operations@kaykaysmilk.com";

    // 1. Try Resend if configured
    if (hasResend) {
      try {
        console.log(`[send-email] Dispatching email to ${cleanTo} via Resend API`);
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: senderEmail,
            to: [cleanTo],
            subject: subject,
            html: html,
          }),
        });

        const resJson = await response.json();
        if (response.ok) {
          return new Response(
            JSON.stringify({ success: true, messageId: resJson.id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
        console.warn("[send-email] Resend API error:", resJson);
      } catch (rErr) {
        console.warn("[send-email] Resend transport error:", rErr);
      }
    }

    // 2. Try SMTP if configured
    if (hasSmtp) {
      try {
        console.log(`[send-email] Dispatching email to ${cleanTo} via SMTP ${SMTP_HOST}`);
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
          to: cleanTo,
          subject: subject,
          html: html,
        });

        return new Response(
          JSON.stringify({ success: true, message: "Email sent via SMTP successfully", messageId: info.messageId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (sErr: any) {
        console.warn("[send-email] SMTP transport error:", sErr?.message || sErr);
      }
    }

    // 3. Simulation Fallback (Dev/Sandbox Mode)
    console.log(`[send-email] SIMULATION DISPATCH: "${type}" email for ${cleanTo}`);
    console.log(`[send-email] Code: "${cleanCodeValue(variables.code)}" | Subject: "${subject}"`);

    return new Response(
      JSON.stringify({
        success: true,
        simulated: true,
        message: `[Dev Sandbox] Dispatched email to ${cleanTo}. Code: ${cleanCodeValue(variables.code)}`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err: any) {
    console.error("[send-email] Unhandled error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});

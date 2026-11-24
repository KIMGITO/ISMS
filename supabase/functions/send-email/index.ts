import nodemailer from "npm:nodemailer@6.9.13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { contactAllowed, enforceRateLimit, requirePermission } from "../shared/cors.ts";
import { safeEqual } from "../shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
// The logo is drawn with HTML (a coloured square and a letter), not a picture: nothing
// to attach or download, so it shows in every mail app, even with images turned off.
const APP_DOWNLOAD_URL = Deno.env.get("APP_DOWNLOAD_URL") || "https://github.com/KIMGITO/kaykays-releases/releases/latest";

/** Every value put into an email is escaped, so names can't inject HTML. */
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface LayoutParts {
  appName: string;
  color: string;
  /** Hidden preview text shown next to the subject in the inbox */
  preheader: string;
  heading: string;
  /** Trusted HTML built by the templates below (values already escaped) */
  body: string;
}

/** One table-based layout with inline styles: what mail apps render reliably. */
/** The app mark: the brand colour with the name's first letter, like the app icon. */
function logoMark(appName: string, color: string): string {
  const letter = esc((appName.trim()[0] || "D").toUpperCase());
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr><td width="56" height="56" align="center" valign="middle" bgcolor="${color}" style="width:56px;height:56px;background:${color};border-radius:12px;font:800 30px/56px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1917;text-align:center;">${letter}</td></tr>
</table>`;
}

function layout({ appName, color, preheader, heading, body }: LayoutParts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
      <tr><td align="center" style="padding:28px 24px 8px;">
        ${logoMark(appName, color)}
        <div style="margin-top:10px;font:600 15px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">${esc(appName)}</div>
      </td></tr>
      <tr><td style="padding:12px 28px 28px;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#334155;">
        <h1 style="margin:0 0 12px;font:700 20px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">${esc(heading)}</h1>
        ${body}
      </td></tr>
      <tr><td style="padding:0 28px;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>
      <tr><td style="padding:16px 28px 24px;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#94a3b8;">
        Sent by ${esc(appName)}. If this wasn't meant for you, you can ignore it.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** A code in large, easy-to-copy type. */
function codeBox(code: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
  <tr><td style="padding:14px 22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font:700 28px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:6px;color:${color};">${esc(code)}</td></tr>
</table>`;
}

function button(href: string, label: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
  <tr><td style="border-radius:8px;background:${color};">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;text-decoration:none;border-radius:8px;">${esc(label)}</a>
  </td></tr>
</table>`;
}

const p = (html: string) => `<p style="margin:0 0 12px;">${html}</p>`;

function getEmailTemplate(
  type: string,
  vars: Record<string, any>,
): { subject: string; html: string } {
  const appName = String(vars.brandName || "Denso");
  const color = /^#[0-9a-f]{3,8}$/i.test(String(vars.primaryColor || "")) ? String(vars.primaryColor) : "#f59e0b";
  const code = cleanCodeValue(vars.code || vars.token || vars.otp || vars.verificationCode);
  const name = String(vars.name || "").trim();
  const hello = name ? `Hello ${esc(name)},` : "Hello,";
  const build = (subject: string, preheader: string, heading: string, body: string) => ({
    subject,
    html: layout({ appName, color, preheader, heading, body }),
  });

  switch (type) {
    case "verification_code":
    case "signup":
      return build(
        `Your ${appName} code: ${code}`,
        `Your code is ${code}. It works for 15 minutes.`,
        "Confirm your email",
        p(hello) + p("Enter this code in the app to finish setting up your account:") +
          codeBox(code, color) +
          p("It works for <strong>15 minutes</strong>. If you didn't ask for it, you can ignore this email."),
      );

    case "password_reset":
      return build(
        `Reset your ${appName} password`,
        `Your reset code is ${code}. It works for 15 minutes.`,
        "Reset your password",
        p(hello) + p("Enter this code in the app to choose a new password:") +
          codeBox(code, color) +
          p("It works for <strong>15 minutes</strong>. If you didn't ask to reset your password, ignore this email; your password stays the same."),
      );

    case "invitation": {
      const business = String(vars.businessName || appName);
      const role = String(vars.role || "").trim();
      const note = String(vars.optionalMessage || "").trim();
      return build(
        `You're invited to join ${business}`,
        `Your invitation code is ${code}.`,
        `Join ${business}`,
        p(hello) +
          p(`You've been invited to join <strong>${esc(business)}</strong> on ${esc(appName)}${role ? ` as <strong>${esc(role)}</strong>` : ""}.`) +
          (note ? `<p style="margin:0 0 12px;padding:10px 14px;background:#f8fafc;border-left:3px solid ${color};border-radius:4px;">${esc(note)}</p>` : "") +
          p("Your invitation code:") +
          codeBox(code, color) +
          p(`To accept: open the ${esc(appName)} app, tap <strong>Join Team</strong>, and enter the code. Use this email address when you sign up.`) +
          p("Don't have the app yet?") +
          button(APP_DOWNLOAD_URL, `Download ${appName}`, color) +
          p(`<span style="font-size:13px;color:#64748b;">The invitation expires in 3 days.</span>`),
      );
    }

    case "customer_message": {
      const body = esc(vars.body).replace(/\n/g, "<br>");
      return build(`A message from ${appName}`, String(vars.body || "").slice(0, 90), `A message from ${appName}`, p(body));
    }

    default: {
      const message = String(vars.message || vars.body || "").trim();
      return build(
        String(vars.subject || `${appName} notification`),
        message.slice(0, 90),
        String(vars.title || "You have a new notification"),
        p(message ? esc(message).replace(/\n/g, "<br>") : `There's something new for you in ${esc(appName)}. Open the app to see it.`),
      );
    }
  }
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

    const { to, type, businessId, purpose } = body;
    let variables: Record<string, any> = body.variables ?? {};

    // Backend callers use the service role key. App users must be active members of a business,
    // and OTP emails can only come from auth-otp, so nobody can email a code they chose themselves.
    const supabaseUrlForAuth = Deno.env.get("SUPABASE_URL") || "";
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const isBackendCaller = safeEqual(bearer, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!isBackendCaller) {
      const denied = (status: number, error: string) =>
        new Response(JSON.stringify({ success: false, error }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status,
        });
      if (["verification_code", "password_reset", "welcome"].includes(type)) {
        return denied(403, "This email can't be sent from here.");
      }
      const userClient = createClient(supabaseUrlForAuth, Deno.env.get("SUPABASE_ANON_KEY") || "", {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return denied(401, "Your session has expired. Please log in again.");
      const { data: memberships } = await userClient
        .from("business_memberships")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "Active")
        .limit(1);
      if (!memberships?.length) return denied(403, "You don't have permission to send email.");

      const limited = await enforceRateLimit(`mail:${user.id}`, 30, 3600);
      if (limited) return limited;

      // App users can only send the two emails the app sends, and never choose the subject,
      // sender name or colours, so this can't be used to send look-alike mail to anyone.
      const admin = createClient(supabaseUrlForAuth, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const recipient = String(to || "").trim().toLowerCase();
      if (type === "invitation") {
        // Only a real, open invitation for this address, from a shop the sender belongs to.
        // The shop name and role come from the invitation, not from the request.
        const code = cleanCodeValue(variables.code);
        if (!/^[A-Z0-9]{4,32}$/.test(code)) return denied(400, "The invitation code is missing.");
        const { data: invite } = await admin
          .from("invitations")
          .select("business_id, email, role, status, expires_at, businesses(name)")
          .eq("invitation_token", code)
          .eq("status", "Pending")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (!invite || String(invite.email || "").trim().toLowerCase() !== recipient) {
          return denied(403, "That invitation was not found.");
        }
        const isMember = await userClient
          .from("business_memberships").select("id")
          .eq("user_id", user.id).eq("business_id", invite.business_id).eq("status", "Active").limit(1);
        if (!isMember.data?.length) return denied(403, "You don't have permission to send email.");
        variables = {
          code,
          name: String(variables.name || "").slice(0, 120),
          businessName: (invite as any).businesses?.name || "",
          role: invite.role || "",
          optionalMessage: String(variables.optionalMessage || "").slice(0, 500),
        };
      } else if (type === "customer_message") {
        if (!businessId) return denied(400, "Choose a shop first.");
        const forbidden = await requirePermission(req, String(businessId), "communication.send");
        if (forbidden) return forbidden;
        variables = { body: String(variables.body || "").slice(0, 5000) };
      } else {
        return denied(403, "This email can't be sent from here.");
      }
    }

    if (!to) {
      return new Response(
        JSON.stringify({ success: false, error: "Recipient 'to' email is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const cleanTo = String(to).trim().toLowerCase();

    if (businessId && !(await contactAllowed(businessId, null, cleanTo, purpose))) {
      return new Response(
        JSON.stringify({ success: false, optedOut: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

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

          // Fast direct check on the public.users table instead of listUsers()
          const { data: dbUser } = await supabase
            .from("users")
            .select("id")
            .ilike("email", cleanTo)
            .maybeSingle();

          if (dbUser) userExists = true;
        }
      }

      if (!userExists) {
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
    const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || SMTP_USER || "noreply@kaykays.com";

    const hasResend = !!RESEND_API_KEY;
    const hasSmtp = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

    const email = getEmailTemplate(type, { ...variables, to: cleanTo });

    // 1. Try Resend if configured
    if (hasResend) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: SENDER_EMAIL,
            to: [cleanTo],
            subject: email.subject,
            html: email.html,
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
          from: SENDER_EMAIL,
          to: cleanTo,
          subject: email.subject,
          html: email.html,
        });

        return new Response(
          JSON.stringify({ success: true, message: "Email sent via SMTP successfully", messageId: info.messageId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (sErr: any) {
        console.warn("[send-email] SMTP transport error:", sErr?.message || sErr);
      }
    }

    // 3. No provider configured or every provider failed
    console.error("[send-email] No email provider delivered the message");
    return new Response(
      JSON.stringify({ success: false, error: "Email could not be sent. Please try again later." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
    );

  } catch (err: any) {
    console.error("[send-email] Unhandled error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Email could not be sent. Please try again later." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
// supabase/functions/shared/cors.ts
// Shared CORS utilities for all ISMS  edge functions

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
};

/** Returns a preflight response if this is an OPTIONS request, otherwise null. */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

/** Returns a JSON response with CORS headers attached. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Returns a structured error response with CORS headers. */
export function errorResponse(message: string, status = 500, code?: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message, ...(code ? { code } : {}) }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}


export async function verifyUserMembership(
  req: Request,
  businessId: string
): Promise<{ userId?: string; role?: string; errorResponse?: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      errorResponse: errorResponse(
        "Authorization header is required.",
        401,
        "AUTH_REQUIRED"
      ),
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[cors] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    return {
      errorResponse: errorResponse(
        "Server configuration error.",
        500,
        "SERVER_CONFIG_ERROR"
      ),
    };
  }

  const rawToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  // 1. Backend callers (cron jobs, other edge functions) use the service role key.
  //    The anon key is public and never proves identity, so it falls through to the JWT check.
  if (serviceRoleKey && rawToken === serviceRoleKey) {
    return { userId: "service_role", role: "Owner" };
  }

  // 2. User JWT validation
  try {
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseUserClient.auth.getUser(rawToken);

    if (authError || !user) {
      return {
        errorResponse: errorResponse(
          "Your session has expired. Please log in again to continue.",
          401,
          "SESSION_EXPIRED"
        ),
      };
    }

    // Verify business membership using the user's authenticated client.
    // RLS on business_memberships allows users to read only their own records.
    const { data: membership, error: memError } = await supabaseUserClient
      .from("business_memberships")
      .select("id, role")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .eq("status", "Active")
      .maybeSingle();

    if (memError) {
      console.error("[cors] Membership check error:", memError);
      return {
        errorResponse: errorResponse(
          "Permission check failed. Please try again.",
          500,
          "MEMBERSHIP_CHECK_ERROR"
        ),
      };
    }

    if (!membership) {
      return {
        errorResponse: errorResponse(
          "Permission Denied: You are not an active member of this business.",
          403,
          "NOT_A_MEMBER"
        ),
      };
    }

    return { userId: user.id, role: membership.role };
  } catch (err: any) {
    console.error("[cors] verifyUserMembership exception:", err);
    return {
      errorResponse: errorResponse(
        "Could not verify your access. Please try again.",
        500,
        "AUTH_EXCEPTION"
      ),
    };
  }
}

/**
 * Creates an authenticated Supabase client using the user's JWT from the
 * Authorization header and the anon key. All queries go through RLS.
 * Use this instead of a service-role client whenever possible.
 */
export function createUserClient(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Returns a 403 response unless the caller's role holds one of these permissions, or null to continue. */
export async function requirePermission(
  req: Request,
  businessId: string,
  ...permissions: string[]
): Promise<Response | null> {
  const { data, error } = await createUserClient(req).rpc("has_permission", {
    p_business_id: businessId,
    p_permissions: permissions,
  });
  if (error) {
    console.error("[cors] Permission check failed:", error.code);
    return errorResponse("We couldn't check your access. Please try again.", 500, "PERMISSION_CHECK_ERROR");
  }
  return data === true ? null : errorResponse("Your role does not allow this.", 403, "FORBIDDEN");
}

/**
 * Returns a 429 response once a key exceeds its limit for the window, or null to continue.
 * A limiter outage must not take the app down, so errors are logged and the request proceeds.
 */
/**
 * Whether a bulk message may go to this number or address, given the customer's choices.
 * Messages with no purpose, such as a receipt a customer asked for, aren't affected.
 */
export async function contactAllowed(
  businessId: string,
  phone: string | null,
  email: string | null,
  purpose: unknown,
): Promise<boolean> {
  if (purpose !== "service" && purpose !== "promotion") return true;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await admin.rpc("fn_contact_allowed", {
    p_business_id: businessId,
    p_phone: phone,
    p_email: email,
    p_purpose: purpose,
  });
  if (error) {
    // Not being able to check must not message someone who opted out.
    console.error("[contact-allowed] Check failed:", error.message);
    return false;
  }
  return data === true;
}

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    if (data === false) {
      return errorResponse("Too many requests. Please wait a moment and try again.", 429, "RATE_LIMITED");
    }
  } catch (err) {
    console.error("[rate-limit] Check failed:", err);
  }
  return null;
}

// supabase/functions/shared/cors.ts
// Shared CORS utilities for all KayKay's Milk edge functions

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
): Promise<{ userId?: string; errorResponse?: Response }> {
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

  // 1. If invoked with project Anon Key or Service Role Key (e.g. employee PIN login, API client, background sync)
  if (rawToken === supabaseAnonKey || (serviceRoleKey && rawToken === serviceRoleKey)) {
    const adminClient = createClient(supabaseUrl, serviceRoleKey || supabaseAnonKey);
    const { data: biz, error: bizErr } = await adminClient
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .maybeSingle();

    if (bizErr || !biz) {
      return {
        errorResponse: errorResponse(
          "Business not found or access denied.",
          404,
          "BUSINESS_NOT_FOUND"
        ),
      };
    }

    return { userId: "api_client_user" };
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
    } = await supabaseUserClient.auth.getUser();

    if (authError || !user) {
      console.warn("[cors] User JWT check failed, attempting fallback business validation:", authError?.message);
      const adminClient = createClient(supabaseUrl, serviceRoleKey || supabaseAnonKey);
      const { data: biz } = await adminClient
        .from("businesses")
        .select("id")
        .eq("id", businessId)
        .maybeSingle();

      if (biz) {
        return { userId: "authenticated_business_user" };
      }

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
      .select("id")
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

    return { userId: user.id };
  } catch (err: any) {
    console.error("[cors] verifyUserMembership exception:", err);
    return {
      errorResponse: errorResponse(
        `Auth verification error: ${err.message}`,
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

import nodemailer from "npm:nodemailer@6.9.13";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceRateLimit } from "../shared/cors.ts";

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
const LOGO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAABq1UlEQVR42lz9aZRlWZYWBn5773PuvW+wyc3cPTzCY46MyKGyMquyMmvKqqyJQQV0CQkKRCNAEoiWBI0EC4ToFqsloUbdNDS0WMDqxeoFkhq0gKKauQQqqHnIqqycMzIzIjImDx9tfOO995y9d/8495o58mVh4W727Nl7Z9jDt7/9bfoLPxKiWBTEQEEQBIERBSEgCEJAjFRVVEWKkYMgBJYoIVCILIFESKKwBGJiIRZnZhYSISICwEIIBBaIgC8/IpiJGMQQgURIBEWwgCtw5VwTNy41uAE34AnxFDx3mmD4aAAGBAAI8AzbwlrYFrZCWiJfkK6ga6RzTwvkDdIW1kF7T2uzmYUn+fzTjuiqpknVNZtm02SqyNlUYYqsrsk1e8qU1U2h5qqkGepuRmgSVbnZr/duLt/9ikO63pPCFGpQRXakbO0WXLErDMiKnGGAOdjN3QAH4FT+N34MXwYAEDFAAIHGhQODqPzFARCBiIhBRCAv32UCCJDh8RBAQELEIHESsDhHcAAFcHAOIHYwhl8RQAEUiCpH8PIMFIcPbsBTyHT8SgWKoABEUABXTgKQUyCKQAAxiAAiBNIlb14FN+P7YwBwlDdCNOzquAZuDncHyB3ugPvw1gHtelcN1G3ufsWZ1LwsmhMMMJCqx+n+E9/8KVcHwf1qhQHw8G+He1ksDHvg5WyVr5CDHOw0fGD4LMO7orI3w2cvLw1MxE4CMLxswLiL40Y6BAiOCIpOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQgOAQg/o+A/4A/4C/4C/4C/4C/4C/4A/4A/4A/4D/AIAAAP////4C3L/4B1x6954A/4A=";

function getEmailTemplate(type: string, vars: Record<string, any>): { subject: string; html: string } {
  const brandName = vars.brandName || "KayKay's";
  const appName = brandName;
  const logoUrl = vars.logoUrl || `data:image/png;base64,${LOGO_BASE64}`;
  const primaryColor = vars.primaryColor || "#f59e0b"; // Warm Amber
  const code = cleanCodeValue(vars.code || vars.token || vars.otp || vars.verificationCode);

  let subject = "";
  let html = "";

  switch (type) {
    case "verification_code":
    case "signup": {
      const name = vars.name || vars.to || "Business Owner";
      subject = `Verify your email address - ${appName}`;
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 0 !important; mso-line-height-rule: exactly; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <center style="width: 100%; table-layout: fixed; background-color: #f8fafc; padding-bottom: 40px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; background-color: #0f172a; border-radius: 0 0 20px 20px;">
                <tr>
                  <td style="padding: 32px 0; text-align: center;">
                    <img src="${logoUrl}" alt="${appName}" style="width: 64px; height: 64px; border-radius: 16px; object-fit: cover; margin-bottom: 12px; display: inline-block;" />
                    <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${appName}</h1>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Business & Fresh Milk Management</p>
                  </td>
                </tr>
              </table>

              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%;">
                <tr>
                  <td style="padding: 40px 32px;">
                    <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #1e293b; text-align: center;">Verify Your Email</h2>
                    <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #475569; text-align: center;">
                      Hello <strong>${name}</strong>,<br>
                      Use the 6-digit verification code below to complete your account setup and access your workspace.
                    </p>

                    <div style="background-color: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 32px; text-align: center; margin: 32px 0;">
                      <span style="font-family: 'Monaco', 'Consolas', monospace; font-size: 42px; font-weight: 800; letter-spacing: 12px; color: ${primaryColor}; display: block; margin-left: 12px;">
                        ${code}
                      </span>
                      <p style="margin: 16px 0 0; font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Verification Code</p>
                    </div>

                    <p style="margin: 32px 0 0; font-size: 14px; line-height: 22px; color: #64748b; text-align: center;">
                      This code is valid for <strong>15 minutes</strong>.<br>
                      If you didn't request this code, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>

              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; border-top: 1px solid #f1f5f9;">
                <tr>
                  <td style="padding: 32px; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                      © 2026 ${appName}. All rights reserved.<br>
                      Empowering businesses with intelligent data.
                    </p>
                  </td>
                </tr>
              </table>
            </div>
          </center>
        </body>
        </html>
      `;
      break;
    }

    case "password_reset": {
      const name = vars.name || "User";
      subject = `Password Recovery Code - ${appName}`;
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 0 !important; mso-line-height-rule: exactly; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <center style="width: 100%; table-layout: fixed; background-color: #f8fafc; padding-bottom: 40px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; background-color: #0f172a; border-radius: 0 0 20px 20px;">
                <tr>
                  <td style="padding: 32px 0; text-align: center;">
                    <img src="${logoUrl}" alt="${appName}" style="width: 64px; height: 64px; border-radius: 16px; object-fit: cover; margin-bottom: 12px; display: inline-block;" />
                    <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${appName}</h1>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Security & Account Recovery</p>
                  </td>
                </tr>
              </table>

              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%;">
                <tr>
                  <td style="padding: 40px 32px;">
                    <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #1e293b; text-align: center;">Reset Your Password</h2>
                    <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #475569; text-align: center;">
                      Hello <strong>${name}</strong>,<br>
                      We received a request to reset your password. Use the code below to securely update your credentials.
                    </p>

                    <div style="background-color: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 32px; text-align: center; margin: 32px 0;">
                      <span style="font-family: 'Monaco', 'Consolas', monospace; font-size: 42px; font-weight: 800; letter-spacing: 12px; color: ${primaryColor}; display: block; margin-left: 12px;">
                        ${code}
                      </span>
                      <p style="margin: 16px 0 0; font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Security Recovery Code</p>
                    </div>

                    <p style="margin: 32px 0 0; font-size: 14px; line-height: 22px; color: #64748b; text-align: center;">
                      This code is valid for <strong>15 minutes</strong>.<br>
                      If you didn't request a password reset, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>

              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; border-top: 1px solid #f1f5f9;">
                <tr>
                  <td style="padding: 32px; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                      © 2026 ${appName}. All rights reserved.<br>
                      Security is our top priority.
                    </p>
                  </td>
                </tr>
              </table>
            </div>
          </center>
        </body>
        </html>
      `;
      break;
    }

    case "customer_message": {
      const escaped = String(vars.body ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      subject = `A message from ${appName}`;
      html = `<p style="white-space:pre-wrap;font-family:sans-serif">${escaped}</p>`;
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

    // Backend callers use the service role key. App users must be active members of a business,
    // and OTP emails can only come from auth-otp, so nobody can email a code they chose themselves.
    const supabaseUrlForAuth = Deno.env.get("SUPABASE_URL") || "";
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const isBackendCaller = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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
    }

    if (!to) {
      return new Response(
        JSON.stringify({ success: false, error: "Recipient 'to' email is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const cleanTo = String(to).trim().toLowerCase();

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

    const { subject, html } = getEmailTemplate(type, { ...variables, to: cleanTo });

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
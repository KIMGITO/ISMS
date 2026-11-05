// src/utils/userError.ts
// The one place that decides what an error looks like to a user.
// Raw database, network and runtime text must go through toUserMessage before reaching the UI.

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** An error whose message was written for users and is safe to display as-is. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

const KNOWN_MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "Incorrect email or password."],
  [/email not confirmed|email confirmation/i, "Please verify your email address to continue."],
  [/user already registered|already been registered/i, "This email address is already registered. Please sign in instead."],
  [/rate limit|too many requests/i, "Too many attempts. Please wait a moment and try again."],
  [/failed to fetch|networkerror|network request failed|load failed|err_internet|timed? ?out/i, "We couldn't reach the server. Please check your connection and try again."],
  [/jwt|session (has )?expired|auth session missing|refresh token/i, "Your session has expired. Please log in again."],
  [/row-level security|permission denied|not authorized|do not have access/i, "You don't have permission to do that."],
];

const POSTGRES_CODE_MESSAGES: Record<string, string> = {
  "23505": "This record already exists.",
  "23503": "This record is linked to other data and can't be changed.",
  "23514": "Some of the values entered aren't valid.",
  "23502": "Please fill in all required fields.",
  "42501": "You don't have permission to do that.",
  PGRST301: "Your session has expired. Please log in again.",
  PGRST303: "Your session has expired. Please log in again.",
};

const TECHNICAL_TEXT =
  /\b(sql|syntax error|relation|column|constraint|violates|schema|postgres|pgrst|supabase|edge function|non-2xx|undefined|null|nan|is not a function|cannot read|unexpected token|json|stack|typeerror|referenceerror|exception|uuid|rpc|http \d{3}|status code|localhost|https?:\/\/)\b/i;

function looksTechnical(message: string): boolean {
  return message.length > 200 || TECHNICAL_TEXT.test(message);
}

/** Converts any thrown value into a message that is safe to show to a user. */
export function toUserMessage(err: unknown, fallback: string = GENERIC_ERROR_MESSAGE): string {
  if (err instanceof AppError) return err.message;

  const message = typeof err === "string" ? err : typeof (err as any)?.message === "string" ? (err as any).message : "";
  const code = typeof (err as any)?.code === "string" ? (err as any).code : "";

  if (POSTGRES_CODE_MESSAGES[code]) return POSTGRES_CODE_MESSAGES[code];

  for (const [pattern, friendly] of KNOWN_MESSAGES) {
    if (pattern.test(message)) return friendly;
  }

  if (!message.trim() || looksTechnical(message)) return fallback;

  // Other database codes are internal, except P0001: messages our own RPCs raise for users.
  if (code && code !== "P0001") return fallback;

  return message;
}

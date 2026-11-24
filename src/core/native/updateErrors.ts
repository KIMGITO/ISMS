// src/core/native/updateErrors.ts
// One list of everything that can go wrong while updating, with the single message
// people see for each. Raw errors (HTTP codes, Rust/Java text) are only logged.
//
// "Temporary" errors are the server's or the network's fault (GitHub answering 502/504,
// a dropped connection, a timeout). They are retried on the spot, and a background check
// that still fails stays quiet and tries again later instead of showing a red banner.

export type UpdateErrorCode =
  | "OFFLINE"
  | "SERVER_UNAVAILABLE"
  | "NETWORK"
  | "BAD_MANIFEST"
  | "DOWNLOAD_FAILED"
  | "CORRUPT_DOWNLOAD"
  | "BAD_SIGNATURE"
  | "SIGNATURE_MISMATCH"
  | "NOT_NEWER"
  | "BAD_APK"
  | "NEEDS_PERMISSION"
  | "NOT_DOWNLOADED"
  | "INSTALL_FAILED"
  | "UNKNOWN";

export const UPDATE_MESSAGES: Record<UpdateErrorCode, string> = {
  OFFLINE: "You're offline. Connect to the internet and try again.",
  SERVER_UNAVAILABLE: "The update server isn't responding right now. The app will try again on its own.",
  NETWORK: "Couldn't reach the update server. Check the connection and try again.",
  BAD_MANIFEST: "The update details couldn't be read. The app will try again on its own.",
  DOWNLOAD_FAILED: "The download stopped before it finished. Tap Try again.",
  CORRUPT_DOWNLOAD: "The download was damaged. Tap Try again.",
  BAD_SIGNATURE: "This update couldn't be verified, so it wasn't installed.",
  SIGNATURE_MISMATCH:
    "This update was signed with a different key than the installed app, so it can't install over it. Uninstall Denso and install the latest version from the releases page once.",
  NOT_NEWER: "The downloaded update isn't newer than this app.",
  BAD_APK: "The downloaded file isn't a valid Denso app.",
  NEEDS_PERMISSION: "Allow Denso to install updates, then tap Install again.",
  NOT_DOWNLOADED: "The update hasn't been downloaded yet.",
  INSTALL_FAILED: "The update couldn't be installed. Tap Try again.",
  UNKNOWN: "Something went wrong while updating. Tap Try again.",
};

/** Worth retrying: the next attempt may well work. */
const TEMPORARY = new Set<UpdateErrorCode>(["SERVER_UNAVAILABLE", "NETWORK", "DOWNLOAD_FAILED", "CORRUPT_DOWNLOAD", "BAD_MANIFEST"]);
/** This exact version will never install here; don't download it again on our own. */
const PERMANENT = new Set<UpdateErrorCode>(["SIGNATURE_MISMATCH", "NOT_NEWER", "BAD_APK", "BAD_SIGNATURE"]);

export class UpdateError extends Error {
  readonly code: UpdateErrorCode;
  /** The original error text, for logs only. */
  readonly detail: string;
  constructor(code: UpdateErrorCode, detail = "") {
    super(UPDATE_MESSAGES[code]);
    this.name = "UpdateError";
    this.code = code;
    this.detail = detail;
  }
  get temporary(): boolean {
    return TEMPORARY.has(this.code);
  }
  get permanent(): boolean {
    return PERMANENT.has(this.code);
  }
}

export type UpdateStage = "check" | "download" | "install";

/** Maps an HTTP status to a code. */
export function codeForHttp(status: number, stage: UpdateStage): UpdateErrorCode {
  if (status >= 500 || status === 429 || status === 408) return "SERVER_UNAVAILABLE";
  if (stage === "check") return "BAD_MANIFEST"; // 404 etc: the file isn't there (yet)
  return "DOWNLOAD_FAILED";
}

/** Turns anything thrown by fetch, the Tauri updater or the Android plugin into an UpdateError. */
export function toUpdateError(err: unknown, stage: UpdateStage): UpdateError {
  if (err instanceof UpdateError) return err;
  const anyErr = err as { code?: unknown; message?: unknown } | null;
  const detail =
    typeof err === "string" ? err : typeof anyErr?.message === "string" ? anyErr.message : String(err ?? "");
  const text = detail.toLowerCase();
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";

  // Codes the Android plugin sends.
  if (code && code in UPDATE_MESSAGES) return new UpdateError(code as UpdateErrorCode, detail);
  if (code === "HTTP" || code === "NETWORK_ERROR") {
    const status = Number(/http\s*(\d{3})/i.exec(detail)?.[1] ?? 0);
    return new UpdateError(status ? codeForHttp(status, stage) : "NETWORK", detail);
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) return new UpdateError("OFFLINE", detail);

  const http = /(?:http|status(?: code)?|response code:?)\s*(\d{3})\b/i.exec(detail);
  if (http) return new UpdateError(codeForHttp(Number(http[1]), stage), detail);

  // Tauri updater ("Could not fetch a valid release JSON from the remote" = every endpoint failed).
  if (text.includes("valid release json")) return new UpdateError("SERVER_UNAVAILABLE", detail);
  if (text.includes("signature")) return new UpdateError("BAD_SIGNATURE", detail);
  if (/(json|deserializ|decod|parse|unexpected token|invalid type|missing field)/.test(text)) {
    return new UpdateError(stage === "check" ? "BAD_MANIFEST" : "DOWNLOAD_FAILED", detail);
  }
  if (/(damaged|checksum|sha-?256|hash)/.test(text)) return new UpdateError("CORRUPT_DOWNLOAD", detail);
  if (/(timed? ?out|timeout|connection|network|dns|resolve|unreachable|reset|refused|socket|ssl|tls|eof|request)/.test(text)) {
    return new UpdateError(stage === "download" ? "DOWNLOAD_FAILED" : "NETWORK", detail);
  }
  if (stage === "download") return new UpdateError("DOWNLOAD_FAILED", detail);
  if (stage === "install") return new UpdateError("INSTALL_FAILED", detail);
  return new UpdateError("UNKNOWN", detail);
}

/**
 * Runs fn, retrying temporary failures after each delay in turn (so delays.length + 1 attempts).
 * Anything else is thrown at once.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  stage: UpdateStage,
  delaysMs: number[] = [2_000, 6_000],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = toUpdateError(err, stage);
      if (!error.temporary || attempt >= delaysMs.length) throw error;
      console.warn(`[UpdateService] ${error.code}, retrying (${attempt + 1}/${delaysMs.length}):`, error.detail);
      await sleep(delaysMs[attempt]);
    }
  }
}

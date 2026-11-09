// src/core/native/updateManifest.ts
// Where installed apps read latest.json, and how a copy is checked before it is trusted.
//
// GitHub's "releases/latest/download" link is the least reliable source: it can point at
// the previous release for a while after publishing, and the file behind it sometimes
// answers 504. So the release workflow also pushes latest.json to the "update-manifest"
// branch, which raw.githubusercontent.com and jsDelivr serve from separate CDNs.
// Keep this list in the same order as plugins.updater.endpoints in src-tauri/tauri.conf.json
// (a test checks this).

import { UpdateError, codeForHttp, toUpdateError, withRetry } from "./updateErrors";

export const MANIFEST_SOURCES = [
  "https://raw.githubusercontent.com/KIMGITO/ISMS/update-manifest/latest.json",
  "https://cdn.jsdelivr.net/gh/KIMGITO/ISMS@update-manifest/latest.json",
  "https://github.com/KIMGITO/ISMS/releases/latest/download/latest.json",
] as const;

export interface ReleaseManifest {
  version: string;
  notes?: string;
  android?: { url: string; sha256?: string };
}

const VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/i;

/** Returns the manifest if it has everything the app needs, otherwise throws BAD_MANIFEST. */
export function parseManifest(body: unknown): ReleaseManifest {
  let data = body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new UpdateError("BAD_MANIFEST", `Not JSON: ${String(body).slice(0, 80)}`);
    }
  }
  const m = data as Record<string, any> | null;
  if (!m || typeof m !== "object") throw new UpdateError("BAD_MANIFEST", "Empty manifest");
  if (typeof m.version !== "string" || !VERSION.test(m.version)) {
    throw new UpdateError("BAD_MANIFEST", `Bad version: ${JSON.stringify(m.version)}`);
  }
  const manifest: ReleaseManifest = { version: m.version, notes: typeof m.notes === "string" ? m.notes : undefined };
  if (m.android != null) {
    const { url, sha256 } = m.android;
    if (typeof url !== "string" || !url.startsWith("https://")) throw new UpdateError("BAD_MANIFEST", "Bad android.url");
    if (sha256 != null && (typeof sha256 !== "string" || !SHA256.test(sha256))) {
      throw new UpdateError("BAD_MANIFEST", "Bad android.sha256");
    }
    manifest.android = { url, sha256 };
  }
  return manifest;
}

export type FetchJson = (url: string) => Promise<{ status: number; data: unknown }>;

/**
 * Tries each source in turn (each with a couple of quick retries) and returns the first
 * valid manifest. Throws the most useful error if none works.
 */
export async function fetchManifest(
  get: FetchJson,
  sources: readonly string[] = MANIFEST_SOURCES,
  delaysMs?: number[],
  sleep?: (ms: number) => Promise<void>,
): Promise<ReleaseManifest> {
  let last: UpdateError | null = null;
  for (const url of sources) {
    try {
      return await withRetry(
        async () => {
          const res = await get(url);
          if (res.status !== 200) throw new UpdateError(codeForHttp(res.status, "check"), `HTTP ${res.status} from ${url}`);
          return parseManifest(res.data);
        },
        "check",
        delaysMs,
        sleep,
      );
    } catch (err) {
      last = toUpdateError(err, "check");
      console.warn(`[UpdateService] ${url} failed: ${last.code} ${last.detail}`);
      if (last.code === "OFFLINE") break;
    }
  }
  throw last ?? new UpdateError("UNKNOWN", "No update sources");
}

// src/services/upload/storageUpload.ts
//
// Uploads one file to Supabase Storage and reports real progress (bytes sent / total), so the
// screen can show a filling bar with a percentage. supabase-js's own upload() has no progress
// callback, so this talks to the same Storage REST endpoint with XMLHttpRequest, using the
// signed-in session, exactly as supabase-js would.

import { getSupabase } from "../supabaseClient";
import { configManager } from "../configManager";

export interface StorageUploadOptions {
  contentType?: string;
  /** Seconds browsers may cache the file. */
  cacheControl?: string;
  upsert?: boolean;
  signal?: AbortSignal;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Uploads `body` to `bucket/path`. `onProgress` gets 0 to 100. Returns the stored path. */
export async function uploadToStorage(
  bucket: string,
  path: string,
  body: Blob,
  options: StorageUploadOptions = {},
  onProgress?: (percent: number) => void,
): Promise<string> {
  const { supabaseUrl, supabaseAnonKey } = configManager.getConfig();
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token ?? supabaseAnonKey;
  const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`;

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", supabaseAnonKey);
    xhr.setRequestHeader("x-upsert", options.upsert ? "true" : "false");
    xhr.setRequestHeader("cache-control", `max-age=${options.cacheControl ?? "3600"}`);
    xhr.setRequestHeader("content-type", options.contentType || body.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(path);
        return;
      }
      let message = `Upload failed (${xhr.status}).`;
      try {
        const parsed = JSON.parse(xhr.responseText);
        message = parsed?.message || parsed?.error || message;
      } catch {
        /* keep the status message */
      }
      const err = new Error(message) as Error & { statusCode?: string };
      err.statusCode = String(xhr.status);
      reject(err);
    };
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

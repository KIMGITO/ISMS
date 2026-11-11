// src/services/backgroundRemoval.ts
//
// Free background removal that runs on this device: no account, no API key, no per-image cost,
// and the photo never leaves the phone or computer.
//
// Model: ISNet general-use, 8-bit (xrds/isnet-general-onnx-int8, MIT licence, about 44 MB).
// Runtime: Transformers.js on ONNX Runtime Web (Apache-2.0), CPU (WebAssembly) only, because
// WebGPU is missing or unreliable in the Android and Windows webviews. The runtime ships inside
// the app; the desktop app's content security policy needs 'wasm-unsafe-eval' for it.
//
// The first use downloads the model once and the library keeps it in the browser cache
// ('transformers-cache'), so later uses work offline. The work runs in
// backgroundRemoval.worker.ts so the screen keeps responding.

import type { WorkerRequest, WorkerResponse } from './backgroundRemoval.worker';

/** Larger photos are scaled down first: the model works at 1024 px and big canvases crash phones. */
const MAX_SIDE = 1600;

export type RemovalStage = 'downloading' | 'preparing' | 'working';

export interface RemovalProgress {
  stage: RemovalStage;
  /**
   * 0 to 100 for the current stage. Downloading is measured; the removal itself cannot report
   * progress, so 'working' is estimated from how long it took on this device before.
   */
  percent?: number;
  /** Seconds left, estimated, while working. */
  secondsLeft?: number;
}

/** Thrown when the caller cancels. The UI should treat it as "nothing happened", not as an error. */
export class RemovalCancelledError extends Error {
  constructor() {
    super('Background removal was cancelled.');
    this.name = 'AbortError';
  }
}

export const isRemovalCancelled = (err: unknown) =>
  err instanceof RemovalCancelledError || (err as { name?: string } | null)?.name === 'AbortError';

// ---------------------------------------------------------------------------
// Worker and the requests waiting on it
// ---------------------------------------------------------------------------

type Pending = {
  resolve: (r: { width: number; height: number; pixels: Uint8ClampedArray }) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: RemovalStage, percent?: number) => void;
};

// One worker serves every request; it handles them one at a time.
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/**
 * Stops the worker for good, which is the only way to stop the model mid-run and give its
 * memory back. Without this, a cancelled run kept going and a retry started a second one beside
 * it, which ran phones out of memory and crashed the app. The next request starts a fresh worker
 * and loads the already downloaded model from the cache.
 */
function killWorker(reason: Error) {
  worker?.terminate();
  worker = null;
  const waiting = [...pending.values()];
  pending.clear();
  waiting.forEach((p) => p.reject(reason));
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./backgroundRemoval.worker.ts', import.meta.url), { type: 'module' });
  w.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const job = pending.get(message.id);
    if (!job) return; // Cancelled: its answer is no longer wanted.
    if (message.type === 'progress') {
      job.onProgress?.(message.stage, message.percent);
      return;
    }
    pending.delete(message.id);
    if (message.type === 'done') job.resolve(message);
    else job.reject(new Error(message.message));
  });
  // A crashed worker (usually out of memory) or one that could not start.
  w.addEventListener('error', (event) => {
    event.preventDefault?.();
    killWorker(new Error(event.message || 'The background remover stopped unexpectedly. The photo may be too large for this device.'));
  });
  w.addEventListener('messageerror', () => killWorker(new Error('The background remover could not read the photo.')));
  worker = w;
  return w;
}

// ---------------------------------------------------------------------------
// Time estimate for the removal step (the model gives no progress of its own)
// ---------------------------------------------------------------------------

const TIMING_KEY = 'kk_bg_removal_ms';
const DEFAULT_WORK_MS = 45_000;

function expectedWorkMs(): number {
  try {
    const saved = Number(localStorage.getItem(TIMING_KEY));
    if (saved > 2_000 && saved < 600_000) return saved;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_WORK_MS;
}

function rememberWorkMs(ms: number) {
  try {
    // Lean towards the newest run, so a faster or slower device settles in a couple of photos.
    const previous = expectedWorkMs();
    localStorage.setItem(TIMING_KEY, String(Math.round(previous === DEFAULT_WORK_MS ? ms : previous * 0.4 + ms * 0.6)));
  } catch {
    /* storage unavailable */
  }
}

/** Fills to 90% at the expected time, then creeps towards 99% so it never sits "done" while still working. */
function estimate(elapsedMs: number, expectedMs: number): { percent: number; secondsLeft?: number } {
  if (elapsedMs < expectedMs) {
    return { percent: Math.round((elapsedMs / expectedMs) * 90), secondsLeft: Math.max(1, Math.ceil((expectedMs - elapsedMs) / 1000)) };
  }
  return { percent: Math.min(99, Math.round(90 + 9 * (1 - Math.exp(-(elapsedMs - expectedMs) / expectedMs)))) };
}

/** A run longer than this is treated as stuck and stopped with a clear message. */
const timeLimitMs = () => Math.max(4 * 60_000, expectedWorkMs() * 4);

/** Loads any image the page can show (data:, blob: or https:) into a canvas, scaled down if huge. */
function toCanvas(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('This device cannot edit images.'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Could not open that image.'));
    img.src = src;
  });
}

/**
 * Trims fully transparent edges, adds a small even margin, and pads with transparency to `aspect`
 * (width / height) so a crop of that shape shows the whole product, centred.
 */
function trimToSubject(source: HTMLCanvasElement, aspect?: number): HTMLCanvasElement {
  const ctx = source.getContext('2d');
  if (!ctx) return source;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return source; // Nothing found: keep the image as it is.
  const w = right - left + 1;
  const h = bottom - top + 1;
  const pad = Math.round(Math.max(w, h) * 0.06);
  let outW = w + pad * 2;
  let outH = h + pad * 2;
  if (aspect && aspect > 0) {
    if (outW / outH < aspect) outW = Math.round(outH * aspect);
    else outH = Math.round(outW / aspect);
  }
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  out.getContext('2d')?.drawImage(source, left, top, w, h, Math.round((outW - w) / 2), Math.round((outH - h) / 2), w, h);
  return out;
}

/**
 * Removes the background from an image and returns a transparent PNG as a data URL,
 * trimmed to the subject with a small margin. `onProgress` reports the one-off download and then
 * the work, with a percentage for both. Pass `signal` to cancel: the work stops at once.
 */
export async function removeBackground(
  src: string,
  onProgress?: (progress: RemovalProgress) => void,
  options: { aspect?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { signal } = options;
  if (signal?.aborted) throw new RemovalCancelledError();
  const canvas = await toCanvas(src);
  if (signal?.aborted) throw new RemovalCancelledError();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This device cannot edit images.');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const id = nextId++;
  const w = getWorker();
  const expected = expectedWorkMs();
  let workStartedAt = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const cleanUp = () => {
    if (ticker) clearInterval(ticker);
    if (limit) clearTimeout(limit);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  };

  try {
    const result = await new Promise<{ width: number; height: number; pixels: Uint8ClampedArray }>((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject,
        onProgress: (stage, percent) => {
          if (stage !== 'working') {
            onProgress?.({ stage, percent: stage === 'preparing' ? (percent ?? 100) : percent });
            return;
          }
          if (workStartedAt) return;
          workStartedAt = Date.now();
          onProgress?.({ stage: 'working', ...estimate(0, expected) });
          ticker = setInterval(() => onProgress?.({ stage: 'working', ...estimate(Date.now() - workStartedAt, expected) }), 250);
          limit = setTimeout(() => {
            killWorker(new Error('Removing the background took too long on this device, so it was stopped. Try again, or use a smaller photo.'));
          }, timeLimitMs());
        },
      });

      onAbort = () => {
        const job = pending.get(id);
        pending.delete(id);
        // Nothing else is waiting: stop the model now and free its memory.
        if (pending.size === 0) killWorker(new RemovalCancelledError());
        job?.reject(new RemovalCancelledError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const request: WorkerRequest = { id, width: canvas.width, height: canvas.height, pixels: data };
      w.postMessage(request, [data.buffer]);
    });
    if (workStartedAt) rememberWorkMs(Date.now() - workStartedAt);
    onProgress?.({ stage: 'working', percent: 100, secondsLeft: 0 });

    const out = document.createElement('canvas');
    out.width = result.width;
    out.height = result.height;
    out.getContext('2d')?.putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0);
    const trimmed = trimToSubject(out, options.aspect);
    if (trimmed === out && !hasVisiblePixels(out)) {
      throw new Error('No product was found in this photo, so nothing was cut out. Try a photo where the product stands out from the background.');
    }
    return trimmed.toDataURL('image/png');
  } finally {
    cleanUp();
  }
}

function hasVisiblePixels(canvas: HTMLCanvasElement): boolean {
  const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
  if (!data) return true;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) return true;
  return false;
}

/** True once the model has been downloaded on this device, so the UI can skip the size warning. */
export async function isBackgroundRemovalReady(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    return keys.some((request) => /isnet-general-onnx-int8.*model_quantized\.onnx/.test(request.url));
  } catch {
    return false;
  }
}

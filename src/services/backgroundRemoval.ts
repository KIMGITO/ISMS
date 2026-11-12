// src/services/backgroundRemoval.ts
//
// Free background removal that runs on this device: no account, no API key, no per-image cost,
// and the photo never leaves the phone or computer. Three engines, fastest first:
//
// - Android app: Google ML Kit subject segmentation (SubjectSegmentationPlugin.java). Runs on
//   the phone's accelerated runtime in about a second; Google Play services fetches its small
//   model once. Phones without Play services fall back to the web engine.
// - Desktop app: the ISNet model run natively with ONNX Runtime on every CPU core
//   (src-tauri/src/bg_removal.rs), about 10 s. The model (44 MB) is downloaded here once and
//   handed to the app, which checks it and keeps it.
// - Browser: the same ISNet model in backgroundRemoval.worker.ts, on the GPU (WebGPU) when there
//   is one, otherwise single-threaded WebAssembly, which is slow (40 s or more).
//
// Model: ISNet general-use, weight-only int8 (xrds/isnet-general-onnx-int8, MIT licence).

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
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

type Engine = 'android' | 'desktop' | 'web';

const DEFAULT_WORK_MS: Record<Engine, number> = { android: 3_000, desktop: 12_000, web: 45_000 };
const timingKey = (engine: Engine) => `kk_bg_removal_ms_${engine}`;

function expectedWorkMs(engine: Engine): number {
  try {
    const saved = Number(localStorage.getItem(timingKey(engine)));
    if (saved > 300 && saved < 600_000) return saved;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_WORK_MS[engine];
}

function rememberWorkMs(engine: Engine, ms: number) {
  try {
    // Lean towards the newest run, so a faster or slower device settles in a couple of photos.
    const previous = expectedWorkMs(engine);
    const next = previous === DEFAULT_WORK_MS[engine] ? ms : previous * 0.4 + ms * 0.6;
    localStorage.setItem(timingKey(engine), String(Math.round(next)));
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
const timeLimitMs = () => Math.max(4 * 60_000, expectedWorkMs('web') * 4);

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

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

interface SubjectSegmentationPlugin {
  removeBackground(options: { image: string }): Promise<{ width: number; height: number; mask: string }>;
  addListener(event: 'segmentationProgress', cb: (e: { percent: number }) => void): Promise<PluginListenerHandle>;
}
const SubjectSegmentation = registerPlugin<SubjectSegmentationPlugin>('SubjectSegmentation');

type TauriInvoke = <T>(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => Promise<T>;
const tauriInvoke = (): TauriInvoke | null =>
  (typeof window !== 'undefined' && (window as unknown as { __TAURI__?: { core?: { invoke?: TauriInvoke } } }).__TAURI__?.core?.invoke) || null;

/** Phones without Google Play services: the Android engine can't work there. */
let androidUnavailable = false;

function pickEngine(): Engine {
  if (!androidUnavailable && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('SubjectSegmentation')) return 'android';
  if (tauriInvoke()) return 'desktop';
  return 'web';
}

const MODEL_URL = 'https://huggingface.co/xrds/isnet-general-onnx-int8/resolve/71eff2372ec9c8edbc6ca637ded591423d23b65a/onnx/model_quantized.onnx';

/** The browser engine may already have the model in its cache: no need to download it twice. */
async function cachedModel(): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open('transformers-cache');
    for (const request of await cache.keys()) {
      if (/isnet-general-onnx-int8.*model_quantized\.onnx/.test(request.url)) {
        const hit = await cache.match(request);
        if (hit) return await hit.arrayBuffer();
      }
    }
  } catch {
    /* cache unavailable */
  }
  return null;
}

async function downloadModel(onPercent: (p: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const cached = await cachedModel();
  if (cached) return new Uint8Array(cached);
  const response = await fetch(MODEL_URL, { signal });
  if (!response.ok || !response.body) throw new Error('Could not download the background remover. Check your internet and try again.');
  const total = Number(response.headers.get('content-length')) || 44_229_662;
  const reader = response.body.getReader();
  const out = new Uint8Array(total);
  let received = 0;
  let chunks: Uint8Array[] | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!chunks && received + value.length <= out.length) out.set(value, received);
    else {
      // Bigger than announced: collect the rest separately.
      chunks ??= [out.subarray(0, received)];
      chunks.push(value);
    }
    received += value.length;
    onPercent(Math.min(100, Math.round((received / total) * 100)));
  }
  if (!chunks) return out.subarray(0, received);
  const all = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return all;
}

/** Desktop app: alpha mask from the native engine, downloading the model first if needed. */
async function desktopMask(
  invoke: TauriInvoke, pixels: Uint8ClampedArray, width: number, height: number,
  onStage: (stage: RemovalStage, percent?: number) => void, signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!(await invoke<boolean>('bg_model_ready'))) {
    onStage('downloading', 0);
    const model = await downloadModel((p) => onStage('downloading', p), signal);
    if (signal?.aborted) throw new RemovalCancelledError();
    onStage('preparing');
    await invoke('bg_save_model', model);
  }
  if (signal?.aborted) throw new RemovalCancelledError();
  onStage('working');
  const raw = await invoke<ArrayBuffer | number[]>('bg_remove', new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
    headers: { 'x-width': String(width), 'x-height': String(height) },
  });
  return raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw);
}

/** Android app: alpha mask from ML Kit. */
async function androidMask(
  canvas: HTMLCanvasElement, onStage: (stage: RemovalStage, percent?: number) => void,
): Promise<Uint8Array> {
  let listener: PluginListenerHandle | undefined;
  try {
    listener = await SubjectSegmentation.addListener('segmentationProgress', (e) => onStage('downloading', e.percent));
    onStage('working');
    const result = await SubjectSegmentation.removeBackground({ image: canvas.toDataURL('image/jpeg', 0.95) });
    if (result.width !== canvas.width || result.height !== canvas.height) throw new Error('The cut-out came back the wrong size.');
    const bin = atob(result.mask);
    const mask = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) mask[i] = bin.charCodeAt(i);
    return mask;
  } finally {
    void listener?.remove();
  }
}

/** Browser: the worker returns the cut-out pixels directly. */
function webPixels(
  pixels: Uint8ClampedArray, width: number, height: number,
  onStage: (stage: RemovalStage, percent?: number) => void, signal?: AbortSignal,
): Promise<{ width: number; height: number; pixels: Uint8ClampedArray }> {
  const id = nextId++;
  const w = getWorker();
  let limit: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  return new Promise<{ width: number; height: number; pixels: Uint8ClampedArray }>((resolve, reject) => {
    pending.set(id, {
      resolve,
      reject,
      onProgress: (stage, percent) => {
        if (stage === 'working' && !limit) {
          limit = setTimeout(() => {
            killWorker(new Error('Removing the background took too long on this device, so it was stopped. Try again, or use a smaller photo.'));
          }, timeLimitMs());
        }
        onStage(stage, percent);
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
    const request: WorkerRequest = { id, width, height, pixels };
    w.postMessage(request, [pixels.buffer]);
  }).finally(() => {
    if (limit) clearTimeout(limit);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  });
}

/**
 * Removes the background from an image and returns a transparent PNG as a data URL,
 * trimmed to the subject with a small margin. `onProgress` reports any one-off download and then
 * the work, with a percentage for both. Pass `signal` to cancel.
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
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let engine = pickEngine();
  let workStartedAt = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const onStage = (stage: RemovalStage, percent?: number) => {
    if (signal?.aborted) return;
    if (stage !== 'working') {
      onProgress?.({ stage, percent: stage === 'preparing' ? (percent ?? 100) : percent });
      return;
    }
    if (workStartedAt) return;
    workStartedAt = Date.now();
    const expected = expectedWorkMs(engine);
    onProgress?.({ stage: 'working', ...estimate(0, expected) });
    ticker = setInterval(() => onProgress?.({ stage: 'working', ...estimate(Date.now() - workStartedAt, expected) }), 250);
  };
  // The native engines can't be stopped mid-photo, but they finish in seconds: a cancel just
  // drops their answer.
  const cancelled = new Promise<never>((_, reject) => {
    if (signal) signal.addEventListener('abort', () => reject(new RemovalCancelledError()), { once: true });
  });
  cancelled.catch(() => {});

  try {
    let result: { width: number; height: number; pixels: Uint8ClampedArray };
    if (engine === 'web') {
      result = await webPixels(image.data, canvas.width, canvas.height, onStage, signal);
    } else {
      let mask: Uint8Array;
      try {
        mask = await Promise.race([
          engine === 'android'
            ? androidMask(canvas, onStage)
            : desktopMask(tauriInvoke()!, image.data, canvas.width, canvas.height, onStage, signal),
          cancelled,
        ]);
      } catch (err) {
        if (isRemovalCancelled(err) || signal?.aborted) throw new RemovalCancelledError();
        // No Google Play services on this phone: use the browser engine instead, from now on.
        if (engine === 'android' && (err as { code?: string })?.code === 'NO_PLAY_SERVICES') {
          androidUnavailable = true;
          engine = 'web';
          if (ticker) clearInterval(ticker);
          workStartedAt = 0;
          const copy = new Uint8ClampedArray(image.data);
          result = await webPixels(copy, canvas.width, canvas.height, onStage, signal);
          mask = new Uint8Array(0);
        } else {
          throw err;
        }
      }
      if (mask.length) {
        if (mask.length !== canvas.width * canvas.height) throw new Error('The cut-out came back the wrong size.');
        const pixels = image.data;
        for (let i = 0; i < mask.length; i++) pixels[i * 4 + 3] = mask[i];
        result = { width: canvas.width, height: canvas.height, pixels };
      }
    }
    if (signal?.aborted) throw new RemovalCancelledError();
    if (workStartedAt) rememberWorkMs(engine, Date.now() - workStartedAt);
    onProgress?.({ stage: 'working', percent: 100, secondsLeft: 0 });

    const out = document.createElement('canvas');
    out.width = result!.width;
    out.height = result!.height;
    out.getContext('2d')?.putImageData(new ImageData(result!.pixels, result!.width, result!.height), 0, 0);
    const trimmed = trimToSubject(out, options.aspect);
    if (trimmed === out && !hasVisiblePixels(out)) {
      throw new Error('No product was found in this photo, so nothing was cut out. Try a photo where the product stands out from the background.');
    }
    return trimmed.toDataURL('image/png');
  } finally {
    if (ticker) clearInterval(ticker);
  }
}

function hasVisiblePixels(canvas: HTMLCanvasElement): boolean {
  const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
  if (!data) return true;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) return true;
  return false;
}

/** True once nothing big needs downloading first, so the UI can skip the size warning. */
export async function isBackgroundRemovalReady(): Promise<boolean> {
  const engine = pickEngine();
  // Google Play services fetches a small model by itself.
  if (engine === 'android') return true;
  if (engine === 'desktop') {
    try {
      return await tauriInvoke()!<boolean>('bg_model_ready');
    } catch {
      return false;
    }
  }
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    return keys.some((request) => /isnet-general-onnx-int8.*model_quantized\.onnx/.test(request.url));
  } catch {
    return false;
  }
}

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
  /** 0 to 100 while downloading, otherwise undefined. */
  percent?: number;
}

// The model runs in a worker so the screen keeps responding; one worker serves every request.
let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./backgroundRemoval.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

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
 * trimmed to the subject with a small margin. `onProgress` reports the one-off download and then the work.
 */
export async function removeBackground(
  src: string,
  onProgress?: (progress: RemovalProgress) => void,
  options: { aspect?: number } = {},
): Promise<string> {
  const canvas = await toCanvas(src);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This device cannot edit images.');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const id = nextId++;
  const w = getWorker();
  const result = await new Promise<{ width: number; height: number; pixels: Uint8ClampedArray }>((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'progress') {
        onProgress?.({ stage: message.stage, percent: message.percent });
        return;
      }
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (message.type === 'done') resolve(message);
      else reject(new Error(message.message));
    };
    const onError = (event: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      // A crashed worker (usually out of memory) is replaced on the next try.
      worker?.terminate();
      worker = null;
      reject(new Error(event.message || 'Background removal stopped unexpectedly.'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    const request: WorkerRequest = { id, width: canvas.width, height: canvas.height, pixels: data };
    w.postMessage(request, [data.buffer]);
  });

  const out = document.createElement('canvas');
  out.width = result.width;
  out.height = result.height;
  out.getContext('2d')?.putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0);
  return trimToSubject(out, options.aspect).toDataURL('image/png');
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

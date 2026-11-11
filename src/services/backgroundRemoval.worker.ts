// src/services/backgroundRemoval.worker.ts
//
// Runs the background-removal model off the main thread, so the app keeps responding while a
// photo is processed (about half a minute on a phone). See backgroundRemoval.ts for the why.

import ortLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

const MODEL_ID = 'xrds/isnet-general-onnx-int8';

export type WorkerRequest = { id: number; width: number; height: number; pixels: Uint8ClampedArray };
export type WorkerResponse =
  | { id: number; type: 'progress'; stage: 'downloading' | 'preparing' | 'working'; percent?: number }
  | { id: number; type: 'done'; width: number; height: number; pixels: Uint8ClampedArray }
  | { id: number; type: 'error'; message: string };

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void }).postMessage(message, transfer);

let currentId = 0;
const progress = (stage: 'downloading' | 'preparing' | 'working', percent?: number) =>
  post({ id: currentId, type: 'progress', stage, percent });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let segmenterPromise: Promise<any> | null = null;

function loadSegmenter() {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    const onnx = env.backends.onnx;
    const version = onnx.versions?.web;
    if (onnx.wasm && version) {
      // The runtime ships with the app, so it loads from 'self' and works offline. The library's
      // default would fetch it from a CDN and load the loader from a blob: URL, which the CSP blocks.
      (env as { useWasmCache?: boolean }).useWasmCache = false;
      onnx.wasm.wasmPaths = { mjs: ortLoaderUrl, wasm: ortWasmUrl } as typeof onnx.wasm.wasmPaths;
      // Threads need cross-origin isolation, which the app doesn't have.
      onnx.wasm.numThreads = 1;
    }

    return pipeline('background-removal', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (event: any) => {
        if (event?.status === 'progress' && typeof event.progress === 'number' && /\.onnx$/.test(event.file ?? '')) {
          progress('downloading', Math.round(Math.min(100, event.progress)));
        } else if (event?.status === 'ready') {
          progress('preparing');
        }
      },
    });
  })();
  // A failed download must not stick: the next try starts again.
  segmenterPromise.catch(() => { segmenterPromise = null; });
  return segmenterPromise;
}

async function handle({ id, width, height, pixels }: WorkerRequest) {
  currentId = id;
  try {
    progress('preparing', 0);
    const segmenter = await loadSegmenter();
    progress('working');
    const { RawImage } = await import('@huggingface/transformers');
    const output = await segmenter(new RawImage(pixels, width, height, 4));
    const result = (Array.isArray(output) ? output[0] : output).rgba();
    const data = new Uint8ClampedArray(result.data);
    post({ id, type: 'done', width: result.width, height: result.height, pixels: data }, [data.buffer]);
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// One photo at a time: two runs of the model side by side can run a phone out of memory.
let queue: Promise<void> = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request));
});

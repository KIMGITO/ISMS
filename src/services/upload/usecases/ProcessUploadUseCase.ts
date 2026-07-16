// src/services/upload/usecases/ProcessUploadUseCase.ts
import { UploadItem, UploadOptions, UploadStatus } from "../domain/entities";
import { UploadClient, OfflineQueue } from "../domain/ports";

export class ProcessUploadUseCase {
  private client: UploadClient;
  private queue: OfflineQueue;
  private onQueueFlushCallbacks: Set<(id: string, resultUrl: string) => void>;

  constructor(client: UploadClient, queue: OfflineQueue) {
    this.client = client;
    this.queue = queue;
    this.onQueueFlushCallbacks = new Set();

    // Auto-listen to window online events to auto-flush queued items
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        console.log("Device online. Automatically flushing offline upload queue...");
        this.flushQueue();
      });
    }
  }

  public registerOnFlushCallback(cb: (id: string, resultUrl: string) => void) {
    this.onQueueFlushCallbacks.add(cb);
  }

  public unregisterOnFlushCallback(cb: (id: string, resultUrl: string) => void) {
    this.onQueueFlushCallbacks.delete(cb);
  }

  /**
   * Main entrypoint to process an upload item
   */
  public async execute(
    item: UploadItem,
    options?: UploadOptions,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    try {
      // 1. Image preprocessing: Crop and Compress
      if (item.file && item.type === "image" && (options?.compress || options?.crop)) {
        item.file = await this.preprocessImage(item.file, options);
        item.size = item.file.size;
      }

      // 2. Check offline state
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (!isOnline) {
        console.warn("Device is offline. Stashing upload item in offline queue.");
        item.status = "queued_offline";
        await this.queue.enqueue(item);
        
        // Return local temporary URL for instant UI response
        const localUrl = item.file ? URL.createObjectURL(item.file) : (item.url || "");
        onProgress?.(100);
        return localUrl;
      }

      // 3. Perform upload with retry logic
      item.status = "uploading";
      const resultUrl = await this.uploadWithRetry(item, options, onProgress);
      
      item.status = "completed";
      item.resultUrl = resultUrl;
      return resultUrl;
    } catch (err: any) {
      item.status = "failed";
      item.error = err.message || "Upload process failed.";
      throw err;
    }
  }

  /**
   * Upload with automatic retries (up to 3 attempts)
   */
  private async uploadWithRetry(
    item: UploadItem,
    options?: UploadOptions,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        item.retryCount = attempt;
        return await this.client.uploadFile(item, options, onProgress);
      } catch (err) {
        attempt++;
        console.warn(`Upload attempt ${attempt} failed for ${item.name}. Retrying...`);
        if (attempt >= maxRetries) {
          throw err;
        }
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    throw new Error("Upload failed after maximum retries.");
  }

  /**
   * Canvas-based WebP compression and crop helper
   */
  private async preprocessImage(file: File, options?: UploadOptions): Promise<File> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = URL.createObjectURL(file);
      
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(file);

          let width = img.width;
          let height = img.height;

          // 1. Handle Resize/Compression limits
          const maxDimension = 1024;
          if (options?.compress && (width > maxDimension || height > maxDimension)) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          // Draw image
          ctx.drawImage(img, 0, 0, width, height);

          // 2. Output as WebP (saving bandwidth)
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), {
                  type: "image/webp",
                  lastModified: Date.now()
                });
                resolve(newFile);
              } else {
                resolve(file);
              }
            },
            "image/webp",
            0.8 // 80% quality compression
          );
        } catch (err) {
          console.error("Canvas preprocessing error:", err);
          resolve(file);
        }
      };

      img.onerror = () => {
        resolve(file);
      };
    });
  }

  /**
   * Flush queue once returning online
   */
  public async flushQueue() {
    try {
      const items = await this.queue.getQueue();
      if (items.length === 0) return;

      console.log(`Processing ${items.length} queued offline uploads...`);

      for (const item of items) {
        try {
          const resultUrl = await this.uploadWithRetry(item);
          await this.queue.dequeue(item.id);
          
          console.log(`Successfully synced offline upload: ${item.name} -> ${resultUrl}`);
          
          // Trigger callbacks
          this.onQueueFlushCallbacks.forEach(cb => cb(item.id, resultUrl));
        } catch (err) {
          console.error(`Failed to sync queued item ${item.name}:`, err);
        }
      }
    } catch (err) {
      console.error("Failed to run flushQueue:", err);
    }
  }
}

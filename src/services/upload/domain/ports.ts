// src/services/upload/domain/ports.ts
import { UploadItem, UploadOptions } from "./entities";

export interface UploadClient {
  /**
   * Upload a physical file or media payload to storage
   */
  uploadFile(
    item: UploadItem,
    options?: UploadOptions,
    onProgress?: (progress: number) => void
  ): Promise<string>;
}

export interface OfflineQueue {
  /**
   * Add a pending item to the offline sync storage
   */
  enqueue(item: UploadItem): Promise<void>;

  /**
   * Get all currently queued offline uploads
   */
  getQueue(): Promise<UploadItem[]>;

  /**
   * Remove an item from the offline sync storage
   */
  dequeue(id: string): Promise<void>;

  /**
   * Clear the entire queue
   */
  clear(): Promise<void>;
}

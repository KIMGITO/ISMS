// src/services/upload/infrastructure/OfflineUploadQueue.ts
import { OfflineQueue } from "../domain/ports";
import { UploadItem } from "../domain/entities";

declare global {
  interface Window {
    _pending_upload_files?: Record<string, File>;
  }
}

const STORAGE_KEY = "kkm_offline_uploads_queue";

export class OfflineUploadQueue implements OfflineQueue {
  constructor() {
    if (typeof window !== "undefined") {
      window._pending_upload_files = window._pending_upload_files || {};
    }
  }

  public async enqueue(item: UploadItem): Promise<void> {
    const queue = this.getMetadataQueue();
    
    // Store file in memory dictionary
    if (item.file && typeof window !== "undefined" && window._pending_upload_files) {
      window._pending_upload_files[item.id] = item.file;
    }

    // Save metadata without file object (which cannot be JSON serialized directly)
    const serializedItem: UploadItem = {
      ...item,
      file: undefined, // strip file reference for serialization
      status: "queued_offline",
      progress: 0
    };

    const exists = queue.findIndex(q => q.id === item.id);
    if (exists >= 0) {
      queue[exists] = serializedItem;
    } else {
      queue.push(serializedItem);
    }

    this.saveMetadataQueue(queue);
  }

  public async getQueue(): Promise<UploadItem[]> {
    const queue = this.getMetadataQueue();
    
    // Hydrate files back from memory
    return queue.map((item) => {
      if (typeof window !== "undefined" && window._pending_upload_files) {
        const file = window._pending_upload_files[item.id];
        if (file) {
          return { ...item, file };
        }
      }
      return item;
    });
  }

  public async dequeue(id: string): Promise<void> {
    const queue = this.getMetadataQueue();
    const updated = queue.filter(item => item.id !== id);
    this.saveMetadataQueue(updated);

    if (typeof window !== "undefined" && window._pending_upload_files) {
      delete window._pending_upload_files[id];
    }
  }

  public async clear(): Promise<void> {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
      window._pending_upload_files = {};
    }
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private getMetadataQueue(): UploadItem[] {
    if (typeof window === "undefined") return [];
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveMetadataQueue(queue: UploadItem[]) {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.error("Failed to serialize offline queue to localStorage:", err);
    }
  }
}

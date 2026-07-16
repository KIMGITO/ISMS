// src/services/printer/PrintQueue.ts
import { bluetoothPrinterService } from "./BluetoothPrinterService";

interface PrintJob {
  id: string; // transaction receipt ID
  data: Uint8Array;
  retryCount: number;
  maxRetries: number;
}

export class PrintQueue {
  private static instance: PrintQueue;
  private queue: PrintJob[] = [];
  private isProcessing = false;
  private processedIds: Set<string> = new Set();

  public static getInstance(): PrintQueue {
    if (!PrintQueue.instance) {
      PrintQueue.instance = new PrintQueue();
    }
    return PrintQueue.instance;
  }

  /**
   * Enqueues a print job
   */
  public enqueue(id: string, data: Uint8Array, maxRetries = 2): void {
    // Prevent double printing if currently in queue or recently printed
    if (this.processedIds.has(id) || this.queue.some((job) => job.id === id)) {
      console.warn(`PrintQueue: Job with ID ${id} is already processed or queued. Preventing duplicate.`);
      return;
    }

    const job: PrintJob = {
      id,
      data,
      retryCount: 0,
      maxRetries
    };

    this.queue.push(job);
    console.log(`PrintQueue: Job ${id} enqueued. Queue size: ${this.queue.length}`);
    
    // Process next job asynchronously
    this.processNext();
  }

  private async processNext() {
    if (this.isProcessing) return;
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const job = this.queue[0];

    console.log(`PrintQueue: Processing job ${job.id} (Attempt ${job.retryCount + 1}/${job.maxRetries + 1})`);

    const success = await bluetoothPrinterService.write(job.data);

    if (success) {
      console.log(`PrintQueue: Job ${job.id} printed successfully.`);
      this.queue.shift(); // Remove completed job
      this.processedIds.add(job.id);
      
      // Limit processed list size to prevent memory bloat
      if (this.processedIds.size > 100) {
        const firstAdded = this.processedIds.values().next().value;
        if (firstAdded !== undefined) this.processedIds.delete(firstAdded);
      }

      this.isProcessing = false;
      this.processNext();
    } else {
      console.warn(`PrintQueue: Job ${job.id} failed to print.`);
      
      if (job.retryCount < job.maxRetries) {
        job.retryCount++;
        // Keep in queue, wait 3 seconds, then try again
        setTimeout(() => {
          this.isProcessing = false;
          this.processNext();
        }, 3000);
      } else {
        console.error(`PrintQueue: Job ${job.id} reached max retries. Dropping from queue.`);
        this.queue.shift(); // Drop failed job
        this.isProcessing = false;
        this.processNext();
      }
    }
  }

  public clearQueue() {
    this.queue = [];
    this.isProcessing = false;
    this.processedIds.clear();
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}

export const printQueue = PrintQueue.getInstance();

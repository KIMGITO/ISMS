// src/services/upload/domain/entities.ts

export type UploadStatus = 
  | "pending" 
  | "uploading" 
  | "completed" 
  | "failed" 
  | "queued_offline";

export type MediaType = 
  | "image" 
  | "pdf" 
  | "excel" 
  | "word" 
  | "csv" 
  | "video";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  type: MediaType;
  status: UploadStatus;
  progress: number;
  file?: File;
  url?: string;
  resultUrl?: string;
  error?: string;
  retryCount: number;
  timestamp: number;
}

export interface UploadOptions {
  compress?: boolean;
  crop?: boolean;
  cropAspect?: number;
  allowedTypes?: MediaType[];
  maxSizeMb?: number;
  bucketName?: string;
}

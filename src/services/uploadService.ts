// src/services/uploadService.ts
import { SupabaseUploadClient } from "./upload/infrastructure/SupabaseUploadClient";
import { OfflineUploadQueue } from "./upload/infrastructure/OfflineUploadQueue";
import { ProcessUploadUseCase } from "./upload/usecases/ProcessUploadUseCase";

const uploadClient = new SupabaseUploadClient();
const offlineQueue = new OfflineUploadQueue();

export const uploadService = new ProcessUploadUseCase(uploadClient, offlineQueue);
export { SupabaseUploadClient, OfflineUploadQueue, ProcessUploadUseCase };

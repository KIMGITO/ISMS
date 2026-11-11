// src/services/upload/infrastructure/SupabaseUploadClient.ts
import { UploadClient } from '../domain/ports';
import { UploadItem, UploadOptions } from '../domain/entities';
import { getSupabase, isSupabaseConfigured } from '../../supabaseClient';
import { uploadToStorage } from '../storageUpload';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useAuthStore } from '../../../stores/authStore';

export class SupabaseUploadClient implements UploadClient {
  public async uploadFile(
    item: UploadItem,
    options?: UploadOptions,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    // 1. Fallback if Supabase is not configured
    if (!isSupabaseConfigured()) {
      console.warn(
        'Supabase is not configured. Falling back to local Object URL for display.',
      );
      if (item.file) {
        // Return object URL for mock preview persistence
        onProgress?.(50);
        await new Promise((resolve) => setTimeout(resolve, 600));
        onProgress?.(100);
        return URL.createObjectURL(item.file);
      }
      if (item.url) {
        onProgress?.(100);
        return item.url; // URL already provided
      }
      throw new Error('No file or URL provided for upload.');
    }

    try {
      const supabase = getSupabase();

      let fileToUpload: File | Blob;
      let fileName = item.name;

      if (item.file) {
        fileToUpload = item.file;
      } else if (item.url) {
        // If it's a URL, fetch it to convert to a Blob for storage saving
        onProgress?.(20);
        const res = await fetch(item.url);
        fileToUpload = await res.blob();
        fileName = item.name || `downloaded_file_${Date.now()}`;
      } else {
        throw new Error('No media payload specified in upload item.');
      }

      onProgress?.(40);

      // Clean filename to remove special chars
      const sanitizedName = fileName.replace(/[^\w.-]/g, '_');

      // Target bucket name resolved dynamically with defensive mapping
      let bucketName = options?.bucketName;
      if (bucketName === 'products') {
        bucketName = 'product-images';
      } else if (bucketName === 'business-covers') {
        bucketName = 'business-logos';
      }

      if (!bucketName) {
        const lowerName = sanitizedName.toLowerCase();
        if (item.type === 'image') {
          if (lowerName.includes('logo')) {
            bucketName = 'business-logos';
          } else if (
            lowerName.includes('avatar') ||
            lowerName.includes('worker') ||
            lowerName.includes('employee') ||
            lowerName.includes('profile') ||
            lowerName.includes('user')
          ) {
            bucketName = 'employee-avatars';
          } else {
            bucketName = 'product-images';
          }
        } else if (item.type === 'pdf' || item.type === 'csv') {
          bucketName = 'receipt-exports';
        } else {
          bucketName = 'expense-receipts';
        }
      }

      // Determine path prefix based on tenant (active business ID) or user ID
      const businessId = useAuthStore.getState().currentBusinessId;
      const userId = useAuthStore.getState().currentUser?.id;
      // Storage only accepts files inside a business folder or the uploader's own folder.
      const pathPrefix = businessId || userId;
      if (!pathPrefix) throw new Error('Please sign in again before uploading.');
      if (fileToUpload.type === 'image/svg+xml') {
        throw new Error('SVG images are not accepted. Please choose a JPG, PNG or WebP photo.');
      }
      const filePath = `${pathPrefix}/${Date.now()}_${sanitizedName}`;

      // Progress stepped to 60 (Pre-flight creation step safely removed to prevent 403 errors)
      onProgress?.(60);

      // Upload with real byte progress, mapped onto 60 to 98 of the overall bar.
      const storedPath = await uploadToStorage(
        bucketName,
        filePath,
        fileToUpload,
        { cacheControl: '3600', upsert: true, contentType: fileToUpload.type || undefined },
        (percent) => onProgress?.(60 + Math.round(percent * 0.38)),
      );

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(storedPath);

      onProgress?.(100);

      if (!urlData || !urlData.publicUrl) {
        throw new Error('Failed to generate public URL for uploaded file.');
      }

      return urlData.publicUrl;
    } catch (err: any) {
      console.error('Supabase Storage Upload Failure:', err);

      let friendlyError =
        err.message || 'Failed to upload to Supabase Storage.';
      const supabaseUrl =
        localStorage.getItem('kkm_supabase_url') ||
        'https://your-project.supabase.co';

      // The bucket refuses file types and sizes it doesn't take (see 20261111001).
      if (/mime type|not supported|415/i.test(friendlyError)) {
        friendlyError = 'That kind of file is not accepted here. Please choose a JPG, PNG or WebP photo (or a PDF for receipts).';
      } else if (/exceeded the maximum|too large|413/i.test(friendlyError)) {
        friendlyError = 'That file is too large. Photos can be up to 10 MB and receipts up to 20 MB.';
      } else if (
        friendlyError.toLowerCase().includes('networkerror') ||
        friendlyError.toLowerCase().includes('fetch') ||
        friendlyError.toLowerCase().includes('network request failed') ||
        err.name === 'TypeError'
      ) {
        friendlyError = `CORS or Network Error: Disallowed reading remote resource at ${supabaseUrl}/storage/v1/object. Please verify that your Supabase URL is configured correctly, your network connection is active, and CORS origins are allowed in your Supabase storage settings.`;
      }

      // Dispatch a prominent system alert toast
      useNotificationStore
        .getState()
        .showToast(
          'Supabase Storage Error',
          friendlyError,
          undefined,
          'error',
          'security',
        );

      throw new Error(friendlyError);
    }
  }
}
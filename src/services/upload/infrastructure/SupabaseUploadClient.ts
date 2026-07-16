// src/services/upload/infrastructure/SupabaseUploadClient.ts
import { UploadClient } from '../domain/ports';
import { UploadItem, UploadOptions } from '../domain/entities';
import { getSupabase, isSupabaseConfigured } from '../../supabaseClient';
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
      const pathPrefix = businessId || userId || 'global';
      const filePath = `${pathPrefix}/${Date.now()}_${sanitizedName}`;

      // Progress stepped to 60 (Pre-flight creation step safely removed to prevent 403 errors)
      onProgress?.(60);

      // Upload file directly to the database-provisioned bucket
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(filePath, fileToUpload, {
          cacheControl: '3600',
          upsert: true,
        });

      if (error) {
        throw error;
      }

      onProgress?.(90);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(data.path);

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

      if (
        friendlyError.toLowerCase().includes('networkerror') ||
        friendlyError.toLowerCase().includes('fetch') ||
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
// Photos for website pages and guides. Shrunk on the device to at most 1600px on the
// long side (webp) so pages stay fast on phones, then stored in the public
// business-logos bucket under the business's own folder, which staff may write to.
import { getSupabase } from '../../services/supabaseClient';
import { uploadToStorage } from '../../services/upload/storageUpload';

const MAX_SIDE = 1600;

async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** `onProgress` gets 0 to 100 while the photo is sent. */
export async function uploadPageImage(businessId: string, file: File, onProgress?: (percent: number) => void): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    throw new Error('Choose a photo (JPG, PNG or WebP).');
  }
  const blob = await shrink(file);
  if (blob.size > 8 * 1024 * 1024) throw new Error('That photo is too large. Choose one under 8 MB.');
  const extension = blob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${businessId}/website/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const storage = getSupabase().storage.from('business-logos');
  onProgress?.(5);
  await uploadToStorage('business-logos', path, blob, { contentType: blob.type || file.type, cacheControl: '31536000', upsert: false }, (p) =>
    onProgress?.(5 + Math.round(p * 0.95)),
  );
  const url = storage.getPublicUrl(path).data.publicUrl;
  if (!url.startsWith('https://')) throw new Error('The photo was saved but its address is not secure (https), so the website cannot show it.');
  return url;
}

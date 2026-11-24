// The shop's own product photos, offered as ready pictures in the website editors (home banner,
// adverts). Only this business's products are listed: no stock photos from another trade.
import { useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventoryStore';
import { shopPictures, ShopPicture } from '../../../website/src/shopPictures';

/** This branch's product photos, each once. */
export function useOwnProductPictures(): ShopPicture[] {
  const products = useInventoryStore((s) => s.products);
  return useMemo(() => shopPictures(products, 48), [products]);
}

export default function OwnProductPictures({ onPick }: { onPick: (src: string) => void }) {
  const pictures = useOwnProductPictures();
  if (pictures.length === 0) {
    return (
      <p className="mt-2 rounded-lg border border-dashed border-app-border p-3 text-sm text-app-text-muted">
        None of your products has a photo yet. Add photos to products in Stock, or upload a picture here.
      </p>
    );
  }
  return (
    <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
      {pictures.map((picture) => (
        <li key={picture.src}>
          <button
            type="button"
            onClick={() => onPick(picture.src)}
            className="w-full rounded-lg border border-app-border bg-app-bg p-1 hover:border-brand-500"
            title={picture.label}
          >
            <img src={picture.src} alt={picture.label} loading="lazy" className="aspect-square w-full object-contain" />
          </button>
        </li>
      ))}
    </ul>
  );
}

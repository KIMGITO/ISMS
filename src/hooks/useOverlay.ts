import { useEffect, useId } from 'react';
import { useOverlayStore, OverlayType } from '../stores/overlayStore';

export function useOverlay(isOpen: boolean, onClose: () => void, type: OverlayType) {
  const id = useId();
  const { pushOverlay, removeOverlay } = useOverlayStore();

  useEffect(() => {
    if (isOpen) {
      pushOverlay({ id, type, close: onClose });
      return () => {
        removeOverlay(id);
      };
    }
  }, [isOpen, type, onClose, id, pushOverlay, removeOverlay]);
}

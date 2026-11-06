import { useEffect, useId, useRef } from 'react';
import { useOverlayStore, OverlayType } from '../stores/overlayStore';

/**
 * While isOpen, the phone's back button calls onClose instead of leaving the screen.
 * onClose may be an inline function; the latest one is always used.
 */
export function useOverlay(isOpen: boolean, onClose: () => void, type: OverlayType) {
  const id = useId();
  const { pushOverlay, removeOverlay } = useOverlayStore();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      pushOverlay({ id, type, close: () => closeRef.current() });
      return () => {
        removeOverlay(id);
      };
    }
  }, [isOpen, type, id, pushOverlay, removeOverlay]);
}

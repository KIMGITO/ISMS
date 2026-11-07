// src/components/shared/SheetLayer.tsx
// Puts a screen's bottom sheets and dialogs on the window's top layer, above the floating
// mobile navigation and the screen's own transforms, so they can use the full height.
// Children keep their "absolute" positioning; it now refers to the whole window.
// Sheets add the phone's bar with pb-[calc(<padding>+var(--inset-bottom))].

import React from 'react';
import { createPortal } from 'react-dom';

export function SheetLayer({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    // Only the sheet and its backdrop take clicks; the empty layer lets them through.
    <div className="fixed inset-0 z-[55] pointer-events-none [&>*]:pointer-events-auto text-app-text">{children}</div>,
    document.body,
  );
}

export default SheetLayer;

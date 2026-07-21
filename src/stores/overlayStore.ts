import { create } from "zustand";

export type OverlayType = "dialog" | "bottom-sheet" | "drawer" | "other";

export interface Overlay {
  id: string;
  type: OverlayType;
  close: () => void;
}

interface OverlayState {
  overlays: Overlay[];
  pushOverlay: (overlay: Overlay) => void;
  removeOverlay: (id: string) => void;
  popTopOverlay: () => boolean;
}

// Priority order for closing overlays (lower index = higher priority to close)
const priorityOrder: Record<OverlayType, number> = {
  "dialog": 0,
  "bottom-sheet": 1,
  "drawer": 2,
  "other": 3,
};

export const useOverlayStore = create<OverlayState>((set, get) => ({
  overlays: [],
  
  pushOverlay: (overlay) => {
    set((state) => {
      // Avoid pushing duplicates
      if (state.overlays.find(o => o.id === overlay.id)) {
        return state;
      }
      return { overlays: [...state.overlays, overlay] };
    });
  },

  removeOverlay: (id) => {
    set((state) => ({
      overlays: state.overlays.filter(o => o.id !== id)
    }));
  },

  popTopOverlay: () => {
    const { overlays } = get();
    
    if (overlays.length === 0) {
      return false;
    }

    // Sort overlays to find the one with the highest priority (lowest priorityOrder value).
    // If multiple have the same priority, we pop the most recently added one.
    const sortedOverlays = [...overlays].sort((a, b) => {
      const priorityA = priorityOrder[a.type];
      const priorityB = priorityOrder[b.type];
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // If priorities are same, the one later in the array (added last) should be closed first
      return overlays.indexOf(b) - overlays.indexOf(a);
    });

    const topOverlay = sortedOverlays[0];
    
    // Close it
    topOverlay.close();
    
    // Remove it from the store preemptively
    set((state) => ({
      overlays: state.overlays.filter(o => o.id !== topOverlay.id)
    }));
    
    return true;
  }
}));

// src/stores/updateStore.ts
// State of the app's own updates, shown by the top progress bar and the About screen.
import { create } from "zustand";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "downloading"
  | "ready"        // downloaded; desktop: waiting to restart, Android: waiting for a tap on Install
  | "installing"   // desktop: installing; Android: system installer is open
  | "needs-permission" // Android: the person must allow installs from this app
  | "failed";

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  platform: "windows" | "linux" | "macos" | "android" | "web";
  availableVersion: string | null;
  notes: string | null;
  /** 0-100, or null when the size isn't known */
  progress: number | null;
  error: string | null;
  lastCheckedAt: string | null;
  set: (patch: Partial<Omit<UpdateState, "set">>) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: "idle",
  currentVersion: __APP_VERSION__,
  platform: "web",
  availableVersion: null,
  notes: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
  set: (patch) => set(patch),
}));

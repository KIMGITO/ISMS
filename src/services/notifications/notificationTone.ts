// src/services/notifications/notificationTone.ts
// Per-device notification tone settings backed by 12 user-uploaded MP3 files.
//
// The user drops files into `public/sounds/`:
//   notification1.mp3 ... notification12.mp3
// Each maps to a friendly display name shown in the tone picker UI.
//
// Web: plays /sounds/notificationN.mp3 with an HTMLAudioElement.
// Native (Capacitor): a sync script copies public/sounds/*.mp3 into
// android/app/src/main/res/raw/ so FCM `sound` + LocalNotifications work.

export type NotificationToneId =
  | "default"
  | "chime"
  | "ding"
  | "soft"
  | "bell"
  | "alert"
  | "priority"
  | "focus"
  | "marimba"
  | "pulse"
  | "reveille"
  | "echo";

export interface NotificationTone {
  id: NotificationToneId;
  /** Friendly name shown in the UI (not the raw filename) */
  label: string;
  description: string;
  /** Source filename inside public/sounds/ (e.g. notification1.mp3) */
  file: string;
  /** Native raw asset name WITHOUT extension (used for FCM `sound` + Capacitor) */
  soundName: string;
}

// Friendly display mapping — 12 custom slots uploaded by the user.
export const NOTIFICATION_TONES: NotificationTone[] = [
  { id: "default", label: "Default", description: "Notification 1 — standard tone", file: "notification1.mp3", soundName: "notification1" },
  { id: "chime", label: "Chime", description: "Notification 2 — bright chime", file: "notification2.mp3", soundName: "notification2" },
  { id: "ding", label: "Ding", description: "Notification 3 — clear ding", file: "notification3.mp3", soundName: "notification3" },
  { id: "soft", label: "Soft", description: "Notification 4 — gentle tone", file: "notification4.mp3", soundName: "notification4" },
  { id: "bell", label: "Bell", description: "Notification 5 — bell ring", file: "notification5.mp3", soundName: "notification5" },
  { id: "alert", label: "Alert", description: "Notification 6 — attention alert", file: "notification6.mp3", soundName: "notification6" },
  { id: "priority", label: "Priority", description: "Notification 7 — high-priority tone", file: "notification7.mp3", soundName: "notification7" },
  { id: "focus", label: "Focus", description: "Notification 8 — focus-friendly tone", file: "notification8.mp3", soundName: "notification8" },
  { id: "marimba", label: "Marimba", description: "Notification 9 — warm marimba", file: "notification9.mp3", soundName: "notification9" },
  { id: "pulse", label: "Pulse", description: "Notification 10 — rhythmic pulse", file: "notification10.mp3", soundName: "notification10" },
  { id: "reveille", label: "Reveille", description: "Notification 11 — bright wake-up call", file: "notification11.mp3", soundName: "notification11" },
  { id: "echo", label: "Echo", description: "Notification 12 — soft echo tone", file: "notification12.mp3", soundName: "notification12" },
];

const STORAGE_KEY = "kkm_notification_tone_v1";

export class NotificationToneService {
  static getTones(): NotificationTone[] {
    return NOTIFICATION_TONES;
  }

  static getToneId(): NotificationToneId {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      if (val && NOTIFICATION_TONES.some((t) => t.id === val)) {
        return val as NotificationToneId;
      }
    } catch {}
    return "default";
  }

  static setToneId(id: NotificationToneId): void {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  }

  static getTone(): NotificationTone {
    const id = this.getToneId();
    return NOTIFICATION_TONES.find((t) => t.id === id) || NOTIFICATION_TONES[0];
  }

  /** Native raw asset name WITHOUT extension — used as `sound` in FCM payloads */
  static getNativeSoundName(): string {
    const tone = this.getTone();
    return `${tone.soundName}.mp3`;
  }

  // -------------------------------------------------------------------------
  // Web playback — plays the user-uploaded MP3 from public/sounds/
  // -------------------------------------------------------------------------
  private static audioEl: HTMLAudioElement | null = null;

  static playWebTone(_reducedMotion = false): void {
    if (typeof window === "undefined") return;

    const tone = this.getTone();
    const src = `/sounds/${tone.file}`;

    try {
      if (!this.audioEl) {
        this.audioEl = new Audio();
        this.audioEl.volume = 0.75;
      }
      this.audioEl.src = src;
      this.audioEl.play().catch((e) => {
        // If the file isn't uploaded yet or autoplay is blocked, fall through silently.
        console.warn("[NotificationTone] Playback failed:", e);
      });
    } catch (e) {
      console.warn("[NotificationTone] Web playback failed:", e);
    }
  }

  /**
   * Total duration is not statically known for MP3s; return null.
   */
  static getToneDurationMs(): number | null {
    return null;
  }
}
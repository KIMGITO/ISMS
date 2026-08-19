// src/services/notifications/notificationTone.ts
// Per-device notification tone settings for web (Web Audio API) and native
// (Capacitor LocalNotifications / PushNotifications channels).

export type NotificationToneId =
  | "default"
  | "chime"
  | "ding"
  | "soft"
  | "bell"
  | "alert"
  | "none";

export interface NotificationTone {
  id: NotificationToneId;
  label: string;
  description: string;
  /** Web Audio pattern: [freq, durationMs, gapMs, ...] alternating freq→hold→gap */
  pattern?: number[];
}

export const NOTIFICATION_TONES: NotificationTone[] = [
  { id: "default", label: "Default", description: "System default tone", pattern: [440, 120, 0] },
  { id: "chime", label: "Chime", description: "Bright two-note chime", pattern: [660, 100, 40, 880, 180, 0] },
  { id: "ding", label: "Ding", description: "Single clear ding", pattern: [523, 180, 0] },
  { id: "soft", label: "Soft", description: "Gentle low tone", pattern: [330, 200, 0] },
  { id: "bell", label: "Bell", description: "Classic bell ring", pattern: [784, 140, 60, 784, 160, 0] },
  { id: "alert", label: "Alert", description: "Attention alert", pattern: [880, 100, 50, 660, 100, 50, 880, 160, 0] },
  { id: "none", label: "Silent", description: "No sound — visual only", pattern: [0, 0, 0] },
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

  /** Native channel sound name used by Capacitor */
  static getNativeSoundName(): string {
    const tone = this.getTone();
    return tone.id === "none"
      ? "default"
      : tone.id === "default"
      ? "beep.wav"
      : `${tone.id}.wav`;
  }

  /**
   * Play the selected tone using Web Audio API (browser/desktop).
   * Gracefully no-ops when silent / unsupported / reduced-motion.
   */
  static playWebTone(reducedMotion = false): void {
    // Server-side (Node/test) environment — no Web Audio API available.
    if (typeof window === "undefined") return;

    const tone = this.getTone();
    if (tone.id === "none" || !tone.pattern || tone.pattern[0] <= 0) return;
    if (reducedMotion) return;

    try {
      const AudioContextClass =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      const pattern = tone.pattern;
      let time = ctx.currentTime;

      for (let i = 0; i < pattern.length; i += 3) {
        const freq = pattern[i];
        const durMs = pattern[i + 1];
        const gapMs = pattern[i + 2];
        if (freq > 0 && durMs > 0) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, time);
          gain.gain.setValueAtTime(0.12, time);
          gain.gain.exponentialRampToValueAtTime(0.001, time + durMs / 1000);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(time);
          osc.stop(time + durMs / 1000);
        }
        time += (durMs + gapMs) / 1000;
      }

      // Cleanup context shortly after playback
      setTimeout(() => {
        ctx.close().catch(() => {});
      }, (pattern.reduce((a, b, i) => (i % 3 === 1 ? a + b : a), 0) + 300));
    } catch (e) {
      console.warn("[NotificationTone] Web playback failed:", e);
    }
  }
}
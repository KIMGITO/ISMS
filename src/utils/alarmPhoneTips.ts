// src/utils/alarmPhoneTips.ts
// Extra switches some phone brands add on top of Android, which can stop the alarm screen
// from opening over the lock screen. The About screen shows the phone's own brand, and each
// step is a button that opens that setting (AlarmSchedulerPlugin.openSettings tries the
// brand's screen and falls back to the app's info page). Names differ a little by model.

import type { AlarmSettingsTarget, AlarmStatus } from '../services/notifications/alarmSync';

export interface PhoneStep {
  text: string;
  /** The settings screen the button opens. */
  target: AlarmSettingsTarget;
}

export interface PhoneBrandTips {
  id: string;
  /** Shown as the heading, e.g. "Tecno, Infinix, itel". */
  name: string;
  /** Lower-case fragments of Build.MANUFACTURER that belong to this brand. */
  makers: string[];
  steps: PhoneStep[];
}

export const PHONE_BRAND_TIPS: PhoneBrandTips[] = [
  {
    id: 'transsion',
    name: 'Tecno, Infinix, itel',
    makers: ['tecno', 'infinix', 'itel', 'transsion'],
    steps: [
      { text: 'Turn on Auto-start for KayKay\'s.', target: 'autostart' },
      { text: 'Allow Display over other apps.', target: 'overlay' },
      { text: 'Turn on Lock screen notifications.', target: 'lockScreen' },
      { text: 'Phone Master: leave KayKay\'s out of power saving.', target: 'powerSaver' },
    ],
  },
  {
    id: 'samsung',
    name: 'Samsung',
    makers: ['samsung'],
    steps: [
      { text: 'Turn on Full screen notifications for KayKay\'s.', target: 'fullScreen' },
      { text: 'Set Battery to Unrestricted.', target: 'battery' },
      { text: 'Background usage limits: keep KayKay\'s out of Sleeping and Deep sleeping apps.', target: 'powerSaver' },
    ],
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi, Redmi, Poco',
    makers: ['xiaomi', 'redmi', 'poco'],
    steps: [
      { text: 'Other permissions: turn on Show on Lock screen and Display pop-up windows while running in the background.', target: 'brandPermissions' },
      { text: 'Turn on Autostart.', target: 'autostart' },
      { text: 'Set Battery saver to No restrictions.', target: 'battery' },
    ],
  },
  {
    id: 'oppo',
    name: 'Oppo, Realme, OnePlus',
    makers: ['oppo', 'realme', 'oneplus'],
    steps: [
      { text: 'Allow Display over other apps.', target: 'overlay' },
      { text: 'Turn on Auto launch.', target: 'autostart' },
      { text: 'Turn on Lock screen notifications.', target: 'lockScreen' },
    ],
  },
  {
    id: 'vivo',
    name: 'Vivo',
    makers: ['vivo', 'iqoo'],
    steps: [
      { text: 'Permissions: turn on Display on lock screen and Background pop-ups.', target: 'brandPermissions' },
      { text: 'Turn on auto-start for KayKay\'s.', target: 'autostart' },
      { text: 'Background power consumption: allow KayKay\'s.', target: 'powerSaver' },
    ],
  },
  {
    id: 'huawei',
    name: 'Huawei, Honor',
    makers: ['huawei', 'honor'],
    steps: [
      { text: 'App launch: set KayKay\'s to Manage manually, with every switch on.', target: 'autostart' },
      { text: 'Turn on Lock screen notifications and Banners.', target: 'lockScreen' },
    ],
  },
];

/** The brand the phone belongs to, or null for stock Android (Pixel, Nokia, Motorola…). */
export function brandFor(manufacturer: string | null | undefined): PhoneBrandTips | null {
  const m = String(manufacturer ?? '').toLowerCase();
  if (!m) return null;
  return PHONE_BRAND_TIPS.find((b) => b.makers.some((maker) => m.includes(maker))) ?? null;
}

/**
 * Whether the phone reports a step as done. Only some settings can be read; the rest
 * return null ("can't tell"), and are shown as a plain button.
 */
export function stepDone(target: AlarmSettingsTarget, status: AlarmStatus | null): boolean | null {
  if (!status) return null;
  if (target === 'fullScreen') return status.fullScreen;
  if (target === 'battery') return status.batteryUnrestricted;
  if (target === 'overlay') return typeof status.overlay === 'boolean' ? status.overlay : null;
  return null;
}

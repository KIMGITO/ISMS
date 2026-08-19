# Notification Sounds

Your 12 custom notification sound files are here. They are already named `notification1.mp3` through `notification12.mp3`.

Each file maps to a friendly display name in the app's tone picker:

| File | Display name |
|------|-------------|
| `notification1.mp3` | Default |
| `notification2.mp3` | Chime |
| `notification3.mp3` | Ding |
| `notification4.mp3` | Soft |
| `notification5.mp3` | Bell |
| `notification6.mp3` | Alert |
| `notification7.mp3` | Priority |
| `notification8.mp3` | Focus |
| `notification9.mp3` | Marimba |
| `notification10.mp3` | Pulse |
| `notification11.mp3` | Reveille |
| `notification12.mp3` | Echo |

**How the iOS / web tone display works:** Friendly names are defined in `src/services/notifications/notificationTone.ts` — the app never shows the raw `notificationN.mp3` filenames to users.

For local / web preview, the browser plays `/sounds/notificationN.mp3` directly.

For the mobile (Capacitor) build:
1. Update the files here (keep the `notificationN.mp3` names)
2. Run `npm run sounds:sync` to copy them into `android/app/src/main/res/raw/`
3. Run `npm run android` (or `npx cap sync android`) to rebuild the native bundle

> If you add more than 12 sounds later, the app only reads the first 12 slots unless `notificationTone.ts` is extended.
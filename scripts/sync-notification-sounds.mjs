// =============================================================================
// sync-notification-sounds.mjs
// Copies the user's custom notification MP3 files from public/sounds/
// into the native Android raw resources directory so they are bundled with
// the APK and playable by FCM push + Capacitor LocalNotifications.
//
// Android raw resource naming rules: lowercase, [a-z0-9_], no extension.
// iOS: files must be added to the Xcode project bundle (no script here).
//
// Run:  npm run tones:sync   (after placing files in public/sounds/)
// =============================================================================
import { mkdirSync, copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SOUNDS_DIR = join(PROJECT_ROOT, "public", "sounds");
const ANDROID_RAW_DIR = join(PROJECT_ROOT, "android", "app", "src", "main", "res", "raw");

const SUPPORTED = [".mp3", ".wav", ".ogg", ".m4a"];

// The 12 expected source filenames (uploaded by the user).
const EXPECTED_FILES = Array.from(
  { length: 12 },
  (_, i) => `notification${i + 1}.mp3`
);

if (!existsSync(SOUNDS_DIR)) {
  console.error(`❌ Sounds folder not found: ${SOUNDS_DIR}`);
  console.error("   Create it and drop notification1.mp3 ... notification8.mp3 inside.");
  process.exit(1);
}

mkdirSync(ANDROID_RAW_DIR, { recursive: true });

// Clean existing notification* sound files to avoid stale assets
const existing = readdirSync(ANDROID_RAW_DIR).filter((f) => /^notification\d+\.(mp3|wav|ogg|m4a)$/i.test(f));
for (const f of existing) {
  rmSync(join(ANDROID_RAW_DIR, f));
  console.log(`🧹 Removed stale ${f}`);
}

let copied = 0;
for (const expected of EXPECTED_FILES) {
  const src = join(SOUNDS_DIR, expected);
  if (existsSync(src)) {
    // Android raw resource name = basename without extension, must be lowercase.
    // notification1.mp3 → notification1 (valid raw resource name).
    const destName = basename(expected, extname(expected)).toLowerCase() + extname(expected).toLowerCase();
    const dest = join(ANDROID_RAW_DIR, destName);
    copyFileSync(src, dest);
    console.log(`✅ Copied ${expected} → ${destName}`);
    copied++;
  } else {
    console.warn(`⚠️  Missing ${expected} — will fall back during playback.`);
  }
}

// Also copy any extra supported sound files (in case the user adds more)
const extraFiles = readdirSync(SOUNDS_DIR).filter(
  (f) => SUPPORTED.includes(extname(f).toLowerCase()) && !EXPECTED_FILES.includes(f)
);
for (const f of extraFiles) {
  const destName = basename(f, extname(f)).toLowerCase() + extname(f).toLowerCase();
  copyFileSync(join(SOUNDS_DIR, f), join(ANDROID_RAW_DIR, destName));
  console.log(`✅ [extra] Copied ${f} → ${destName}`);
  copied++;
}

console.log(`\n🎉 Sound sync complete: ${copied} sound file(s) bundled.`);
console.log(`Web server reads from: public/sounds/`);
console.log(`Android bundles raw assets from: ${ANDROID_RAW_DIR}`);
console.log("Run `npx cap sync android` after this to refresh the native project.");
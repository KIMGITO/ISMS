// src/core/native/UpdateService.ts
// Keeps the installed app up to date from GitHub Releases.
//   Desktop (Tauri): the updater plugin downloads a signed installer, then the app restarts.
//   Android: the APK is downloaded and Android's installer opens; Android always asks to confirm.
//   Web: nothing to do, a reload already loads the newest version.
// It checks shortly after start, whenever the connection comes back, and every few hours.

import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { useUpdateStore } from "../../stores/updateStore";
import { compareVersions } from "../../utils/semver";
import { notificationService } from "./NotificationService";

const MANIFEST_URL = "https://github.com/KIMGITO/ISMS/releases/latest/download/latest.json";
export const RELEASES_PAGE = "https://github.com/KIMGITO/ISMS/releases";
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** After an automatic check fails, wait this long before trying again on its own. */
const RETRY_AFTER_FAILURE_MS = 6 * 60 * 60 * 1000;
const MEMORY_KEY = "kaykays.update";

/**
 * Remembered across restarts so a broken update isn't retried on every launch.
 *  blocked:  a version that can never install over this app (e.g. signed with another key)
 *  prompted: the version whose installer we already opened once on our own
 *  failedAt: when the last automatic attempt failed
 */
interface UpdateMemory {
  blocked?: { version: string; error: string };
  prompted?: string;
  failedAt?: string;
}

function readMemory(): UpdateMemory {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function remember(patch: Partial<UpdateMemory>): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...readMemory(), ...patch }));
  } catch {
    // Storage unavailable: worst case we retry more often.
  }
}

/** Android plugin errors that mean this exact version will never install. */
const PERMANENT_ANDROID_ERRORS = new Set(["SIGNATURE_MISMATCH", "NOT_NEWER", "BAD_APK"]);

interface AndroidManifestEntry {
  url: string;
  sha256?: string;
}

interface ReleaseManifest {
  version: string;
  notes?: string;
  android?: AndroidManifestEntry;
}

interface AppUpdatePlugin {
  download(options: { url: string; version: string; sha256?: string }): Promise<{ path: string }>;
  install(options: { version: string }): Promise<void>;
  addListener(event: "progress", fn: (p: { percent: number }) => void): Promise<PluginListenerHandle>;
}
const AppUpdate = registerPlugin<AppUpdatePlugin>("AppUpdate");

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const store = () => useUpdateStore.getState();

function message(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

class UpdateService {
  private started = false;
  private busy = false;
  private pendingTauriUpdate: { install: () => Promise<void> } | null = null;

  /** Fills in the installed version and platform. Safe to call more than once. */
  public async init(): Promise<void> {
    try {
      if (isTauri()) {
        const [{ getVersion }, os] = await Promise.all([import("@tauri-apps/api/app"), this.tauriOs()]);
        store().set({ currentVersion: await getVersion(), platform: os });
      } else if (Capacitor.getPlatform() === "android") {
        const info = await App.getInfo();
        store().set({ currentVersion: info.version, platform: "android" });
      }
    } catch (err) {
      console.warn("[UpdateService] Could not read the app version:", err);
    }
  }

  public canUpdate(): boolean {
    return isTauri() || Capacitor.getPlatform() === "android";
  }

  /** Starts automatic checks. Does nothing in the browser or in development. */
  public start(): void {
    if (this.started || !this.canUpdate() || import.meta.env.DEV) return;
    this.started = true;
    this.init();
    const auto = () => { if (navigator.onLine) this.checkAndUpdate(true); };
    setTimeout(auto, FIRST_CHECK_DELAY_MS);
    window.addEventListener("online", auto);
    setInterval(auto, CHECK_EVERY_MS);

    // Android: coming back to the app while "installing" means the installer was closed
    // without updating (a successful update restarts the app). Offer Install again
    // instead of looking stuck.
    if (Capacitor.getPlatform() === "android") {
      App.addListener("resume", () => {
        if (store().status === "installing") store().set({ status: "ready" });
      }).catch(() => {});
    }
  }

  /**
   * Checks for a newer release and, if there is one, downloads it.
   * @param automatic true for background checks, which stay quiet when nothing is found
   */
  public async checkAndUpdate(automatic = false): Promise<void> {
    if (this.busy) return;
    const { status } = store();
    if (status === "ready" || status === "installing") return;
    if (automatic) {
      const { failedAt } = readMemory();
      if (failedAt && Date.now() - new Date(failedAt).getTime() < RETRY_AFTER_FAILURE_MS) return;
    }
    if (!navigator.onLine) {
      if (!automatic) store().set({ status: "failed", error: "You're offline. Connect to the internet and try again." });
      return;
    }

    this.busy = true;
    store().set({ status: "checking", error: null, progress: null });
    try {
      if (isTauri()) await this.updateDesktop();
      else if (Capacitor.getPlatform() === "android") await this.updateAndroid(automatic);
      else store().set({ status: "up-to-date" });
      remember({ failedAt: undefined });
    } catch (err: any) {
      const error = message(err, "The update couldn't be downloaded.");
      console.error("[UpdateService]", err);
      store().set({ status: "failed", error });
      if (PERMANENT_ANDROID_ERRORS.has(err?.code) && store().availableVersion) {
        // Never download this version again on our own; a newer release is tried normally.
        remember({ blocked: { version: store().availableVersion!, error } });
      } else if (automatic) {
        remember({ failedAt: new Date().toISOString() });
        notificationService.sendLocalNotification("Update failed", "Open About this app to try again.").catch(() => {});
      }
    } finally {
      store().set({ lastCheckedAt: new Date().toISOString() });
      this.busy = false;
    }
  }

  /** Desktop: installs the downloaded update and restarts the app. */
  public async restartToUpdate(): Promise<void> {
    if (!this.pendingTauriUpdate) return;
    store().set({ status: "installing" });
    try {
      await this.pendingTauriUpdate.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      store().set({ status: "failed", error: message(err, "The update couldn't be installed.") });
    }
  }

  /** Android: opens the installer again, e.g. after allowing installs from this app. */
  public async installAndroid(): Promise<void> {
    const version = store().availableVersion;
    if (!version) return;
    try {
      await AppUpdate.install({ version });
      remember({ prompted: version });
      store().set({ status: "installing", error: null });
    } catch (err: any) {
      if (PERMANENT_ANDROID_ERRORS.has(err?.code)) {
        const error = message(err, "This update can't be installed over the current app.");
        remember({ blocked: { version, error } });
        store().set({ status: "failed", error });
      } else if (err?.code === "NEEDS_PERMISSION") {
        store().set({ status: "needs-permission", error: message(err, "Allow installs from this app, then try again.") });
      } else if (err?.code === "NOT_DOWNLOADED") {
        store().set({ status: "idle" });
        await this.checkAndUpdate();
      } else {
        store().set({ status: "failed", error: message(err, "The installer couldn't be opened.") });
      }
    }
  }

  private async tauriOs(): Promise<"windows" | "linux" | "macos"> {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("windows")) return "windows";
    if (ua.includes("mac")) return "macos";
    return "linux";
  }

  private announce(version: string) {
    notificationService
      .sendLocalNotification("Updating KayKay's", `Downloading version ${version}. You can keep working.`)
      .catch(() => {});
  }

  private async updateDesktop(): Promise<void> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      store().set({ status: "up-to-date", availableVersion: null });
      return;
    }

    store().set({ status: "downloading", availableVersion: update.version, notes: update.body ?? null, progress: 0 });
    this.announce(update.version);

    let total = 0;
    let done = 0;
    await update.download((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        done += event.data.chunkLength;
        store().set({ progress: total ? Math.min(100, Math.round((done / total) * 100)) : null });
      }
      if (event.event === "Finished") store().set({ progress: 100 });
    });

    this.pendingTauriUpdate = update;
    store().set({ status: "ready" });
  }

  private async updateAndroid(automatic: boolean): Promise<void> {
    const res = await CapacitorHttp.get({ url: MANIFEST_URL, headers: { Accept: "application/json" } });
    if (res.status !== 200) throw new Error(`Couldn't check for updates (HTTP ${res.status}).`);
    const manifest: ReleaseManifest = typeof res.data === "string" ? JSON.parse(res.data) : res.data;

    if (!manifest.android?.url || compareVersions(manifest.version, store().currentVersion) <= 0) {
      store().set({ status: "up-to-date", availableVersion: null });
      return;
    }

    const { blocked, prompted } = readMemory();
    if (automatic && blocked?.version === manifest.version) {
      // Known not to install over this app; say so once per launch, don't download again.
      store().set({ status: "failed", availableVersion: manifest.version, error: blocked.error });
      return;
    }

    store().set({ status: "downloading", availableVersion: manifest.version, notes: manifest.notes ?? null, progress: 0 });
    if (prompted !== manifest.version) this.announce(manifest.version);

    const listener = await AppUpdate.addListener("progress", ({ percent }) => {
      store().set({ progress: percent >= 0 ? percent : null });
    });
    try {
      await AppUpdate.download({ url: manifest.android.url, version: manifest.version, sha256: manifest.android.sha256 });
    } finally {
      listener.remove();
    }
    store().set({ progress: 100 });

    // Open Android's installer on our own only the first time. If it was closed without
    // installing, wait for a tap on Install instead of popping it up on every launch.
    if (automatic && prompted === manifest.version) {
      store().set({ status: "ready" });
      return;
    }
    await this.installAndroid();
  }
}

export const updateService = new UpdateService();
export default updateService;

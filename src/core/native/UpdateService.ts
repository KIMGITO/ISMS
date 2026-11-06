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
  }

  /**
   * Checks for a newer release and, if there is one, downloads it.
   * @param automatic true for background checks, which stay quiet when nothing is found
   */
  public async checkAndUpdate(automatic = false): Promise<void> {
    if (this.busy) return;
    const { status } = store();
    if (status === "ready" || status === "installing") return;
    if (!navigator.onLine) {
      if (!automatic) store().set({ status: "failed", error: "You're offline. Connect to the internet and try again." });
      return;
    }

    this.busy = true;
    store().set({ status: "checking", error: null, progress: null });
    try {
      if (isTauri()) await this.updateDesktop();
      else if (Capacitor.getPlatform() === "android") await this.updateAndroid();
      else store().set({ status: "up-to-date" });
    } catch (err) {
      const error = message(err, "The update couldn't be downloaded.");
      console.error("[UpdateService]", err);
      store().set({ status: "failed", error });
      notificationService.sendLocalNotification("Update failed", "Open About this app to try again.").catch(() => {});
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
      store().set({ status: "installing", error: null });
    } catch (err: any) {
      if (err?.code === "NEEDS_PERMISSION") {
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

  private async updateAndroid(): Promise<void> {
    const res = await CapacitorHttp.get({ url: MANIFEST_URL, headers: { Accept: "application/json" } });
    if (res.status !== 200) throw new Error(`Couldn't check for updates (HTTP ${res.status}).`);
    const manifest: ReleaseManifest = typeof res.data === "string" ? JSON.parse(res.data) : res.data;

    if (!manifest.android?.url || compareVersions(manifest.version, store().currentVersion) <= 0) {
      store().set({ status: "up-to-date", availableVersion: null });
      return;
    }

    store().set({ status: "downloading", availableVersion: manifest.version, notes: manifest.notes ?? null, progress: 0 });
    this.announce(manifest.version);

    const listener = await AppUpdate.addListener("progress", ({ percent }) => {
      store().set({ progress: percent >= 0 ? percent : null });
    });
    try {
      await AppUpdate.download({ url: manifest.android.url, version: manifest.version, sha256: manifest.android.sha256 });
    } finally {
      listener.remove();
    }
    store().set({ progress: 100 });
    await this.installAndroid();
  }
}

export const updateService = new UpdateService();
export default updateService;

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
import { UpdateError, toUpdateError, withRetry, type UpdateStage } from "./updateErrors";
import { fetchManifest } from "./updateManifest";

export const RELEASES_PAGE = "https://github.com/KIMGITO/ISMS/releases";
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** After an automatic check fails, wait this long before trying again on its own. */
const RETRY_AFTER_FAILURE_MS = 6 * 60 * 60 * 1000;
/** After a temporary failure (server down, connection dropped), try again sooner. */
const RETRY_AFTER_TEMPORARY_FAILURE_MS = 30 * 60 * 1000;
/** How long one request for latest.json may take. */
const MANIFEST_TIMEOUT_MS = 15_000;
const MEMORY_KEY = "kaykays.update";

/**
 * Remembered across restarts so a broken update isn't retried on every launch.
 *  blocked:  a version that can never install over this app (e.g. signed with another key)
 *  prompted: the version whose installer we already opened once on our own
 *  failedAt: when the last automatic attempt failed; retryAfter: when to try again on our own
 */
interface UpdateMemory {
  blocked?: { version: string; error: string };
  prompted?: string;
  failedAt?: string;
  retryAfter?: string;
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

interface AppUpdatePlugin {
  download(options: { url: string; version: string; sha256?: string }): Promise<{ path: string }>;
  install(options: { version: string }): Promise<void>;
  addListener(event: "progress", fn: (p: { percent: number }) => void): Promise<PluginListenerHandle>;
}
const AppUpdate = registerPlugin<AppUpdatePlugin>("AppUpdate");

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const store = () => useUpdateStore.getState();

/** Shows a failure in the bar and the About screen, with the standard message for it. */
function showFailure(error: UpdateError) {
  console.error(`[UpdateService] ${error.code}:`, error.detail);
  store().set({
    status: error.code === "NEEDS_PERMISSION" ? "needs-permission" : "failed",
    error: error.message,
    errorCode: error.code,
  });
}

class UpdateService {
  private started = false;
  private busy = false;
  /** What checkAndUpdate is doing right now, so a failure gets the right message. */
  private stage: UpdateStage = "check";
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
      const { retryAfter } = readMemory();
      if (retryAfter && Date.now() < new Date(retryAfter).getTime()) return;
    }
    if (!navigator.onLine) {
      if (!automatic) showFailure(new UpdateError("OFFLINE"));
      return;
    }

    this.busy = true;
    this.stage = "check";
    const before = { status, error: store().error, errorCode: store().errorCode };
    store().set({ status: "checking", error: null, errorCode: null, progress: null });
    try {
      if (isTauri()) await this.updateDesktop();
      else if (Capacitor.getPlatform() === "android") await this.updateAndroid(automatic);
      else store().set({ status: "up-to-date" });
      remember({ failedAt: undefined, retryAfter: undefined });
    } catch (err) {
      const error = toUpdateError(err, this.stage);
      const version = store().availableVersion;
      if (error.permanent && version) {
        // Never download this version again on our own; a newer release is tried normally.
        remember({ blocked: { version, error: error.message } });
        showFailure(error);
      } else if (automatic && error.temporary) {
        // GitHub or the connection had a bad moment. Nothing for the person to do, so
        // no red banner and no notification: put things back and try again soon.
        console.warn(`[UpdateService] Background check failed (${error.code}), retrying later:`, error.detail);
        store().set({ ...before, status: before.status === "checking" ? "idle" : before.status, progress: null });
        remember({ failedAt: new Date().toISOString(), retryAfter: new Date(Date.now() + RETRY_AFTER_TEMPORARY_FAILURE_MS).toISOString() });
        setTimeout(() => this.checkAndUpdate(true), RETRY_AFTER_TEMPORARY_FAILURE_MS + 1_000);
      } else {
        showFailure(error);
        if (automatic) {
          remember({ failedAt: new Date().toISOString(), retryAfter: new Date(Date.now() + RETRY_AFTER_FAILURE_MS).toISOString() });
          notificationService.sendLocalNotification("Update failed", "Open About this app to try again.").catch(() => {});
        }
      }
    } finally {
      store().set({ lastCheckedAt: new Date().toISOString() });
      this.busy = false;
    }
  }

  /** Desktop: installs the downloaded update and restarts the app. */
  public async restartToUpdate(): Promise<void> {
    if (!this.pendingTauriUpdate) return;
    store().set({ status: "installing", error: null, errorCode: null });
    try {
      await this.pendingTauriUpdate.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      showFailure(toUpdateError(err, "install"));
    }
  }

  /** Android: opens the installer again, e.g. after allowing installs from this app. */
  public async installAndroid(): Promise<void> {
    const version = store().availableVersion;
    if (!version) return;
    try {
      await AppUpdate.install({ version });
      remember({ prompted: version });
      store().set({ status: "installing", error: null, errorCode: null });
    } catch (err) {
      const error = toUpdateError(err, "install");
      if (error.code === "NOT_DOWNLOADED") {
        store().set({ status: "idle" });
        await this.checkAndUpdate();
        return;
      }
      if (error.permanent) remember({ blocked: { version, error: error.message } });
      showFailure(error);
    }
  }

  private async tauriOs(): Promise<"windows" | "linux" | "macos"> {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("windows")) return "windows";
    if (ua.includes("mac")) return "macos";
    return "linux";
  }

  /** The green bar shows downloads, so no system notification for them. */
  private announce(_version: string) {}

  private async updateDesktop(): Promise<void> {
    const { check } = await import("@tauri-apps/plugin-updater");
    // The updater tries each endpoint in tauri.conf.json in turn; this retries the whole round.
    const update = await withRetry(() => check({ timeout: MANIFEST_TIMEOUT_MS }), "check");
    if (!update) {
      store().set({ status: "up-to-date", availableVersion: null });
      return;
    }

    store().set({ status: "downloading", availableVersion: update.version, notes: update.body ?? null, progress: 0 });
    this.announce(update.version);

    this.stage = "download";
    await withRetry(() => {
      let total = 0;
      let done = 0;
      store().set({ progress: 0 });
      return update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          store().set({ progress: total ? Math.min(100, Math.round((done / total) * 100)) : null });
        }
        if (event.event === "Finished") store().set({ progress: 100 });
      });
    }, "download", [5_000, 15_000]);

    this.pendingTauriUpdate = update;
    store().set({ status: "ready" });
  }

  private async updateAndroid(automatic: boolean): Promise<void> {
    const manifest = await fetchManifest((url) =>
      CapacitorHttp.get({
        url,
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        connectTimeout: MANIFEST_TIMEOUT_MS,
        readTimeout: MANIFEST_TIMEOUT_MS,
      }),
    );

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

    const apk = manifest.android;

    store().set({ status: "downloading", availableVersion: manifest.version, notes: manifest.notes ?? null, progress: 0 });
    if (prompted !== manifest.version) this.announce(manifest.version);

    const listener = await AppUpdate.addListener("progress", ({ percent }) => {
      store().set({ progress: percent >= 0 ? percent : null });
    });
    this.stage = "download";
    try {
      await withRetry(
        () => AppUpdate.download({ url: apk.url, version: manifest.version, sha256: apk.sha256 }),
        "download",
        [5_000, 15_000],
      );
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

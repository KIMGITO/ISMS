package com.kaykays.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/**
 * Downloads a new APK from the app's GitHub release and hands it to Android's installer.
 * Android always asks the person to confirm, and the first time it asks them to allow
 * installs from this app. The APK must be signed with the same key as the installed app.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private File apkFile(String version) {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "kaykays-" + version.replaceAll("[^0-9A-Za-z.\\-]", "") + ".apk");
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b));
        return out.toString();
    }

    private static String sha256Of(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
    }

    /** SHA-256 of each signing certificate, or null when Android can't tell us. */
    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) throws Exception {
        if (info == null) return null;
        Signature[] sigs;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signing = info.signingInfo;
            if (signing == null) return null;
            sigs = signing.hasMultipleSigners() ? signing.getApkContentsSigners() : signing.getSigningCertificateHistory();
        } else {
            sigs = info.signatures;
        }
        if (sigs == null || sigs.length == 0) return null;
        Set<String> out = new HashSet<>();
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Signature sig : sigs) out.add(hex(digest.digest(sig.toByteArray())));
        return out;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    /**
     * Android refuses an update signed with a different key, or one that isn't newer, and
     * only says "App not installed". Check both first so the app can explain it instead of
     * opening the installer again and again. Returns an error code, or null when it's fine.
     */
    @SuppressWarnings("deprecation")
    private String checkInstallable(File apk) {
        try {
            PackageManager pm = getContext().getPackageManager();
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? PackageManager.GET_SIGNING_CERTIFICATES
                    : PackageManager.GET_SIGNATURES;
            PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), flags);
            PackageInfo update = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
            if (update == null) return "BAD_APK";
            if (!getContext().getPackageName().equals(update.packageName)) return "BAD_APK";
            if (versionCode(update) <= versionCode(installed)) return "NOT_NEWER";

            Set<String> mine = signers(installed);
            Set<String> theirs = signers(update);
            // If Android can't report signatures, let the installer decide.
            if (mine != null && theirs != null) {
                Set<String> shared = new HashSet<>(mine);
                shared.retainAll(theirs);
                if (shared.isEmpty()) return "SIGNATURE_MISMATCH";
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String explain(String code) {
        switch (code) {
            case "SIGNATURE_MISMATCH":
                return "This update was signed with a different key than the installed app, so Android won't install it over this one. Uninstall KayKay's and install the latest version from the releases page once.";
            case "NOT_NEWER":
                return "The downloaded update isn't newer than the installed app.";
            default:
                return "The downloaded update isn't a valid KayKay's app.";
        }
    }

    /** Resolves with the APK path, or rejects with a code if it can't be installed over this app. */
    private void finish(PluginCall call, File apk) {
        String problem = checkInstallable(apk);
        if (problem != null) {
            apk.delete();
            call.reject(explain(problem), problem);
            return;
        }
        JSObject result = new JSObject();
        result.put("path", apk.getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version", "latest");
        String expectedSha = call.getString("sha256");
        if (url == null || !url.startsWith("https://")) {
            call.reject("A secure download link is required.");
            return;
        }

        new Thread(() -> {
            File target = apkFile(version);
            File partial = new File(target.getPath() + ".part");
            HttpURLConnection conn = null;
            try {
                // Already downloaded earlier (e.g. the installer was closed): don't fetch it again.
                if (target.exists()) {
                    if (expectedSha == null || expectedSha.isEmpty() || sha256Of(target).equalsIgnoreCase(expectedSha)) {
                        finish(call, target);
                        return;
                    }
                    target.delete();
                }

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                conn.connect();
                if (conn.getResponseCode() != 200) {
                    throw new Exception("Download failed with HTTP " + conn.getResponseCode());
                }
                long total = conn.getContentLengthLong();
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long done = 0;
                int lastPercent = -1;
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        digest.update(buffer, 0, read);
                        done += read;
                        int percent = total > 0 ? (int) (done * 100 / total) : -1;
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("downloaded", done);
                            progress.put("total", total);
                            progress.put("percent", percent);
                            notifyListeners("progress", progress);
                        }
                    }
                }

                if (expectedSha != null && !expectedSha.isEmpty()) {
                    if (!hex(digest.digest()).equalsIgnoreCase(expectedSha)) {
                        partial.delete();
                        throw new Exception("The download was damaged. Please try again.");
                    }
                }

                if (target.exists()) target.delete();
                if (!partial.renameTo(target)) throw new Exception("Could not save the update.");

                finish(call, target);
            } catch (Exception e) {
                partial.delete();
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed.");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /** Opens Android's installer for a downloaded version. */
    @PluginMethod
    public void install(PluginCall call) {
        String version = call.getString("version", "latest");
        File apk = apkFile(version);
        if (!apk.exists()) {
            call.reject("The update hasn't been downloaded.", "NOT_DOWNLOADED");
            return;
        }
        String problem = checkInstallable(apk);
        if (problem != null) {
            apk.delete();
            call.reject(explain(problem), problem);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            call.reject("Allow KayKay's to install updates, then tap Install again.", "NEEDS_PERMISSION");
            return;
        }

        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}

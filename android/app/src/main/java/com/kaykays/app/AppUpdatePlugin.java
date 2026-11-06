package com.kaykays.app;

import android.content.Intent;
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
                    StringBuilder hex = new StringBuilder();
                    for (byte b : digest.digest()) hex.append(String.format("%02x", b));
                    if (!hex.toString().equalsIgnoreCase(expectedSha)) {
                        partial.delete();
                        throw new Exception("The download was damaged. Please try again.");
                    }
                }

                if (target.exists()) target.delete();
                if (!partial.renameTo(target)) throw new Exception("Could not save the update.");

                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                call.resolve(result);
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

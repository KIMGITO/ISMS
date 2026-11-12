package com.kaykays.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.moduleinstall.ModuleInstall;
import com.google.android.gms.common.moduleinstall.ModuleInstallClient;
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest;
import com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions;
import java.nio.FloatBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Cuts the product out of a photo on the phone with Google's ML Kit subject segmentation.
 *
 * The web model took minutes on phones and often never finished; this runs on the phone's own
 * accelerated runtime in about a second, free and offline once Google Play services has the
 * model (a one-off download of a few MB, started here if needed).
 *
 * removeBackground({ image: base64 JPEG/PNG }) resolves { width, height, mask: base64 }, where the
 * mask holds one alpha byte (0 to 255) per pixel. Progress of the one-off download is sent as
 * "segmentationProgress" events with { percent }.
 */
@CapacitorPlugin(name = "SubjectSegmentation")
public class SubjectSegmentationPlugin extends Plugin {

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SubjectSegmenter segmenter;

    private synchronized SubjectSegmenter segmenter() {
        if (segmenter == null) {
            SubjectSegmenterOptions options = new SubjectSegmenterOptions.Builder()
                .enableForegroundConfidenceMask()
                .build();
            segmenter = SubjectSegmentation.getClient(options);
        }
        return segmenter;
    }

    @PluginMethod
    public void removeBackground(PluginCall call) {
        String image = call.getString("image");
        if (image == null || image.isEmpty()) {
            call.reject("No photo was given.");
            return;
        }
        ModuleInstallClient installer = ModuleInstall.getClient(getContext());
        SubjectSegmenter seg = segmenter();
        installer
            .areModulesAvailable(seg)
            .addOnSuccessListener(response -> {
                if (response.areModulesAvailable()) {
                    run(call, image);
                } else {
                    install(call, image, installer, seg);
                }
            })
            // Usually no Google Play services (e.g. Huawei): the app falls back to its own engine.
            .addOnFailureListener(e -> call.reject("Google Play services is not available.", "NO_PLAY_SERVICES"));
    }

    private void install(PluginCall call, String image, ModuleInstallClient installer, SubjectSegmenter seg) {
        final boolean[] finished = { false };
        ModuleInstallRequest request = ModuleInstallRequest.newBuilder()
            .addApi(seg)
            .setListener(update -> {
                ModuleInstallStatusUpdate.ProgressInfo info = update.getProgressInfo();
                if (info != null && info.getTotalBytesToDownload() > 0) {
                    JSObject progress = new JSObject();
                    progress.put("percent", (int) (100 * info.getBytesDownloaded() / info.getTotalBytesToDownload()));
                    notifyListeners("segmentationProgress", progress);
                }
                int state = update.getInstallState();
                synchronized (finished) {
                    if (finished[0]) return;
                    if (state == ModuleInstallStatusUpdate.InstallState.STATE_COMPLETED) {
                        finished[0] = true;
                        run(call, image);
                    } else if (state == ModuleInstallStatusUpdate.InstallState.STATE_FAILED
                        || state == ModuleInstallStatusUpdate.InstallState.STATE_CANCELED) {
                        finished[0] = true;
                        call.reject("Could not download the background remover. Check your internet and try again.", "UNAVAILABLE");
                    }
                }
            })
            .build();
        installer
            .installModules(request)
            .addOnSuccessListener(response -> {
                if (response.areModulesAlreadyInstalled()) {
                    synchronized (finished) {
                        if (finished[0]) return;
                        finished[0] = true;
                    }
                    run(call, image);
                }
            })
            .addOnFailureListener(e -> {
                synchronized (finished) {
                    if (finished[0]) return;
                    finished[0] = true;
                }
                call.reject("This phone can't download the background remover (Google Play services is needed).", "NO_PLAY_SERVICES");
            });
    }

    private void run(PluginCall call, String image) {
        worker.execute(() -> {
            Bitmap bitmap;
            try {
                String data = image.contains(",") ? image.substring(image.indexOf(',') + 1) : image;
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            } catch (Throwable t) {
                call.reject("Could not read the photo.");
                return;
            }
            if (bitmap == null) {
                call.reject("Could not read the photo.");
                return;
            }
            final int width = bitmap.getWidth();
            final int height = bitmap.getHeight();
            segmenter()
                .process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener(worker, result -> {
                    FloatBuffer confidence = result.getForegroundConfidenceMask();
                    if (confidence == null) {
                        call.reject("No product was found in this photo.");
                        return;
                    }
                    confidence.rewind();
                    byte[] mask = new byte[width * height];
                    for (int i = 0; i < mask.length && confidence.hasRemaining(); i++) {
                        float v = confidence.get();
                        mask[i] = (byte) Math.round(Math.max(0f, Math.min(1f, v)) * 255f);
                    }
                    JSObject out = new JSObject();
                    out.put("width", width);
                    out.put("height", height);
                    out.put("mask", Base64.encodeToString(mask, Base64.NO_WRAP));
                    call.resolve(out);
                })
                .addOnFailureListener(worker, e -> {
                    String message = e.getMessage() != null ? e.getMessage() : "Background removal failed.";
                    boolean unavailable = message.toLowerCase().contains("unavailable") || message.toLowerCase().contains("download");
                    call.reject(unavailable ? "The background remover is still downloading. Try again in a moment." : message,
                        unavailable ? "UNAVAILABLE" : "FAILED");
                })
                .addOnCompleteListener(worker, task -> bitmap.recycle());
        });
    }
}

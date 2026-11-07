package com.kaykays.app;

import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Turns the screen sideways while a chart is open full screen, and back afterwards.
 *
 * The WebView ignores the browser's screen.orientation.lock(), so the web app asks
 * the activity directly. "sensorLandscape" lets either landscape side be used.
 */
@CapacitorPlugin(name = "ScreenOrientation")
public class ScreenOrientationPlugin extends Plugin {

    @PluginMethod
    public void lockLandscape(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            call.resolve();
        });
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            call.resolve();
        });
    }
}

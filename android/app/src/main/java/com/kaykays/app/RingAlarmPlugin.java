package com.kaykays.app;

import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/**
 * Connects the ringing service to the web app.
 *  - "accept" event / getPendingAccept(): the person tapped Accept on a ringing alert.
 *  - stop({ id }): the alert was accepted in the app.
 *  - keepOnly({ businessId, ids }): stops alerts someone else accepted.
 */
@CapacitorPlugin(name = "RingAlarm")
public class RingAlarmPlugin extends Plugin {

    private static RingAlarmPlugin instance;
    private static JSObject pendingAccept;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by MainActivity when it is opened from Accept. */
    static void deliverAccept(Intent intent) {
        if (intent == null || !RingService.ACTION_ACCEPT.equals(intent.getAction())) return;
        String id = intent.getStringExtra(RingService.EXTRA_ID);
        if (id == null) return;

        JSObject data = new JSObject();
        data.put("id", id);
        data.put("actionTarget", intent.getStringExtra(RingService.EXTRA_TARGET));
        data.put("businessId", intent.getStringExtra(RingService.EXTRA_BUSINESS));

        // Don't handle the same tap twice if the activity is recreated.
        intent.setAction(Intent.ACTION_MAIN);

        if (instance != null && instance.hasListeners("accept")) {
            instance.notifyListeners("accept", data);
        } else {
            pendingAccept = data;
        }
    }

    @PluginMethod
    public void getPendingAccept(PluginCall call) {
        JSObject result = new JSObject();
        result.put("accept", pendingAccept);
        pendingAccept = null;
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String id = call.getString("id");
        if (id != null) RingService.cancel(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void keepOnly(PluginCall call) {
        String businessId = call.getString("businessId");
        JSArray ids = call.getArray("ids", new JSArray());
        List<String> keep = new ArrayList<>();
        try {
            keep = ids.toList();
        } catch (Exception ignored) {
        }
        if (businessId != null) RingService.keepOnly(getContext(), businessId, keep);
        call.resolve();
    }

    @PluginMethod
    public void ringing(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ids", new JSArray(RingService.ringingIds()));
        call.resolve(result);
    }
}

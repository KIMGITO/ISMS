package com.kaykays.app;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;

/**
 * Connects the ringing service to the web app.
 *  - "accept" event / takePendingAccepts(): Accept was tapped (on the alarm screen or the
 *    notification). The taps are saved, so ones made while the app was closed arrive when it opens.
 *  - stop({ id }): the alert was accepted in the app.
 *  - keepOnly({ businessId, ids }): stops alerts someone else accepted.
 *  - setTone({ sound }): the ringing tone chosen in Settings ("alarm" or a raw sound name).
 */
@CapacitorPlugin(name = "RingAlarm")
public class RingAlarmPlugin extends Plugin {

    private static RingAlarmPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Sends waiting Accept taps to the app, if it is open and listening. */
    static void flush(Context context) {
        RingAlarmPlugin p = instance;
        if (p == null || !p.hasListeners("accept")) return;
        JSONArray list = AlarmStore.takeAccepts(context);
        for (int i = 0; i < list.length(); i++) {
            try {
                p.notifyListeners("accept", JSObject.fromJSONObject(list.getJSONObject(i)));
            } catch (Exception ignored) {
            }
        }
    }

    @PluginMethod
    public void takePendingAccepts(PluginCall call) {
        JSONArray list = AlarmStore.takeAccepts(getContext());
        JSObject result = new JSObject();
        try {
            result.put("accepts", new JSArray(list.toString()));
        } catch (Exception e) {
            result.put("accepts", new JSArray());
        }
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
    public void setTone(PluginCall call) {
        RingService.setTone(getContext(), call.getString("sound", "alarm"));
        call.resolve();
    }

    @PluginMethod
    public void ringing(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ids", new JSArray(RingService.ringingIds()));
        call.resolve(result);
    }
}

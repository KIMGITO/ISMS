package com.kaykays.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The web app's handle on the phone's own alarms.
 *  - replaceAll({ ownerId, alarms }): the full list from get_my_alarms(); the phone sets each one.
 *  - clearAll(): sign-out.
 *  - status(): everything that can stop an alarm ringing, for the Settings health check.
 *  - openSettings({ target }): the Android screen that fixes one of those.
 *  - testAlarm({ seconds }): a phone-only alarm, to check this phone really rings.
 */
@CapacitorPlugin(name = "AlarmScheduler")
public class AlarmSchedulerPlugin extends Plugin {

    @PluginMethod
    public void replaceAll(PluginCall call) {
        String owner = call.getString("ownerId", "");
        if (owner == null || owner.isEmpty()) {
            call.reject("ownerId is required");
            return;
        }
        JSArray list = call.getArray("alarms", new JSArray());
        List<AlarmStore.Alarm> alarms = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null) alarms.add(AlarmStore.Alarm.fromJson(o));
        }
        int set = AlarmScheduler.replaceAll(getContext(), owner, alarms);
        JSObject result = new JSObject();
        result.put("saved", alarms.size());
        result.put("scheduled", set);
        result.put("nextAt", AlarmScheduler.soonest(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        AlarmScheduler.clearAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        android.content.Context c = getContext();
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER);
        r.put("notificationsEnabled", NotificationManagerCompat.from(c).areNotificationsEnabled());
        r.put("alarmChannelEnabled", NotificationChannels.enabled(c, NotificationChannels.RING));
        r.put("generalChannelEnabled", NotificationChannels.enabled(c, NotificationChannels.DEFAULT));
        r.put("exactAlarms", AlarmScheduler.canExact(c));
        r.put("fullScreen", RingService.canUseFullScreen(c));
        PowerManager pm = c.getSystemService(PowerManager.class);
        r.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        int gid = c.getResources().getIdentifier("google_app_id", "string", c.getPackageName());
        r.put("pushAvailable", gid != 0 && !c.getString(gid).isEmpty());
        r.put("scheduled", AlarmStore.all(c).size());
        r.put("nextAt", AlarmScheduler.soonest(c));
        r.put("signedInOwner", !AlarmStore.owner(c).isEmpty());
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "app");
        String pkg = getContext().getPackageName();
        Intent i;
        switch (target == null ? "app" : target) {
            case "notifications":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                break;
            case "alarmChannel":
                i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, NotificationChannels.RING);
                break;
            case "exactAlarm":
                i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg))
                    : appDetails(pkg);
                break;
            case "fullScreen":
                i = Build.VERSION.SDK_INT >= 34
                    ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg))
                    : appDetails(pkg);
                break;
            case "battery":
                // The list of apps; the person picks KayKay's and chooses "Unrestricted"/"Don't optimise".
                i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                break;
            default:
                i = appDetails(pkg);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (ActivityNotFoundException e) {
            // Some phones lack the specific screen; the app's own page always exists.
            getContext().startActivity(appDetails(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    private static Intent appDetails(String pkg) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
    }

    /** A phone-only alarm "seconds" from now. It rings like a reminder but is never sent to the server. */
    @PluginMethod
    public void testAlarm(PluginCall call) {
        int seconds = Math.max(10, Math.min(call.getInt("seconds", 60), 3600));
        long at = System.currentTimeMillis() + seconds * 1000L;
        java.text.SimpleDateFormat day = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
        java.text.SimpleDateFormat time = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US);
        day.setTimeZone(AlarmScheduler.ZONE);
        time.setTimeZone(AlarmScheduler.ZONE);
        // Alarms are per minute, so round up to the next whole minute.
        long minute = ((at + 59_999) / 60_000) * 60_000;
        AlarmStore.Alarm a = new AlarmStore.Alarm();
        a.id = "test-" + System.currentTimeMillis();
        a.userId = AlarmStore.owner(getContext());
        a.title = "Test alarm";
        a.notes = "If you can hear this with the app closed, reminders will ring on this phone.";
        a.date = day.format(new java.util.Date(minute));
        a.time = time.format(new java.util.Date(minute));
        a.test = true;
        AlarmStore.put(getContext(), a);
        long scheduled = AlarmScheduler.schedule(getContext(), a);
        Log.i(AlarmScheduler.TAG_SCHEDULE, "test alarm requested for " + AlarmScheduler.iso(minute));
        JSObject r = new JSObject();
        r.put("at", scheduled);
        r.put("exact", AlarmScheduler.canExact(getContext()));
        call.resolve(r);
    }

    /** The alarms saved on this phone (ids, times; no titles), for diagnostics. */
    @PluginMethod
    public void list(PluginCall call) {
        JSONArray out = new JSONArray();
        long now = System.currentTimeMillis();
        for (AlarmStore.Alarm a : AlarmStore.all(getContext())) {
            AlarmScheduler.Next n = AlarmScheduler.next(getContext(), a, now);
            JSONObject o = new JSONObject();
            try {
                o.put("id", a.id).put("repeat", a.repeat).put("test", a.test)
                    .put("nextAt", n == null ? 0 : n.at).put("occurrence", n == null ? "" : n.occurrence);
            } catch (Exception ignored) {
            }
            out.put(o);
        }
        JSObject r = new JSObject();
        try {
            r.put("alarms", new JSArray(out.toString()));
        } catch (Exception e) {
            r.put("alarms", new JSArray());
        }
        call.resolve(r);
    }
}

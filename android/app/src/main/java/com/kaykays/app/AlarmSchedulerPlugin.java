package com.kaykays.app;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
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
        r.put("overlay", Settings.canDrawOverlays(c));
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
        List<Intent> tries = settingsIntents(target == null ? "app" : target, pkg);
        // The app's own info page always exists, so every button opens something.
        tries.add(appDetails(pkg));
        for (Intent i : tries) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(i);
                call.resolve();
                return;
            } catch (ActivityNotFoundException | SecurityException e) {
                // This phone doesn't have that screen (another brand, or a newer/older version): next.
            }
        }
        call.resolve();
    }

    /**
     * Screens to try, best first, for one setting. Brand screens live in each brand's own
     * system app and move between versions, so each lists the known places; the ones a phone
     * lacks are skipped. Names collected from the brands' system apps (see dontkillmyapp.com).
     */
    private List<Intent> settingsIntents(String target, String pkg) {
        List<Intent> l = new ArrayList<>();
        Uri pkgUri = Uri.parse("package:" + pkg);
        switch (target) {
            case "notifications":
            case "lockScreen":
                l.add(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
                break;
            case "alarmChannel":
                l.add(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, NotificationChannels.RING));
                break;
            case "exactAlarm":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    l.add(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkgUri));
                }
                break;
            case "fullScreen":
                if (Build.VERSION.SDK_INT >= 34) l.add(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkgUri));
                break;
            case "overlay":
                l.add(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkgUri));
                break;
            case "battery": {
                // One tap "Allow" for this app; the full list if the phone won't show that.
                PowerManager pm = getContext().getSystemService(PowerManager.class);
                if (pm == null || !pm.isIgnoringBatteryOptimizations(pkg)) {
                    l.add(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri));
                }
                l.add(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                break;
            }
            case "autostart":
                // Xiaomi, Redmi, Poco
                l.add(component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                // Tecno, Infinix, itel
                l.add(component("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"));
                // Oppo, Realme
                l.add(component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
                l.add(component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"));
                l.add(component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"));
                // OnePlus
                l.add(component("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"));
                // Vivo
                l.add(component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
                l.add(component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"));
                // Huawei, Honor ("App launch")
                l.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                l.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"));
                l.add(component("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                break;
            case "brandPermissions":
                // Xiaomi "Other permissions": Show on Lock screen, pop-ups while in background
                l.add(component("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")
                    .setAction("miui.intent.action.APP_PERM_EDITOR").putExtra("extra_pkgname", pkg));
                l.add(new Intent("miui.intent.action.APP_PERM_EDITOR").putExtra("extra_pkgname", pkg));
                // Vivo: Display on lock screen, Background pop-ups
                l.add(component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity")
                    .setAction("secure.intent.action.softPermissionDetail").putExtra("packagename", pkg));
                break;
            case "powerSaver":
                // Tecno, Infinix, itel (Phone Master)
                l.add(component("com.transsion.phonemaster", "com.cyin.himgr.powermanager.views.activity.PowerManagerActivity"));
                // Samsung (Background usage limits)
                l.add(component("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"));
                l.add(component("com.samsung.android.sm", "com.samsung.android.sm.battery.ui.BatteryActivity"));
                // Huawei
                l.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.power.ui.HwPowerManagerActivity"));
                // Vivo (Background power consumption)
                l.add(component("com.iqoo.powersaving", "com.iqoo.powersaving.PowerSavingManagerActivity"));
                l.addAll(settingsIntents("battery", pkg));
                break;
            default:
                break;
        }
        return l;
    }

    private static Intent component(String pkg, String cls) {
        return new Intent().setComponent(new ComponentName(pkg, cls));
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

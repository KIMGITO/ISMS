package com.kaykays.app;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Rings a reminder when its alarm goes off, and sets every alarm again whenever Android may have
 * dropped or shifted them: after a reboot, an app update, a clock or time-zone change, or when
 * the exact-alarm permission is granted.
 */
public class AlarmReceiver extends BroadcastReceiver {

    private static final String TAG_TRIGGER = "ALARM_TRIGGER";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) return;

        if (AlarmScheduler.ACTION_FIRE.equals(action)) {
            fire(context, intent);
            return;
        }

        switch (action) {
            case Intent.ACTION_BOOT_COMPLETED:
            case "android.intent.action.QUICKBOOT_POWERON":
            case Intent.ACTION_MY_PACKAGE_REPLACED:
            case Intent.ACTION_TIME_CHANGED:
            case Intent.ACTION_TIMEZONE_CHANGED:
            case AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED:
                // Android drops every alarm on reboot. BOOT_COMPLETED comes after the first
                // unlock, when this app's storage can be read.
                try {
                    PendingResult pending = goAsync();
                    new Thread(() -> {
                        try {
                            AlarmScheduler.rescheduleAll(context, action);
                        } catch (Exception e) {
                            Log.e(AlarmScheduler.TAG_SCHEDULE, "reschedule after " + action + " failed", e);
                        } finally {
                            pending.finish();
                        }
                    }).start();
                } catch (Exception e) {
                    Log.e(AlarmScheduler.TAG_SCHEDULE, "reschedule after " + action + " failed", e);
                }
                break;
            default:
                break;
        }
    }

    private void fire(Context context, Intent intent) {
        String id = intent.getStringExtra(AlarmScheduler.EXTRA_ID);
        String occurrence = intent.getStringExtra(AlarmScheduler.EXTRA_OCCURRENCE);
        long at = intent.getLongExtra(AlarmScheduler.EXTRA_AT, System.currentTimeMillis());
        if (id == null || occurrence == null) return;
        long late = System.currentTimeMillis() - at;
        Log.i(TAG_TRIGGER, "fired " + AlarmScheduler.shortId(id) + " occurrence=" + occurrence
            + " scheduled=" + AlarmScheduler.iso(at) + " late_ms=" + late);

        AlarmStore.Alarm a = AlarmStore.get(context, id);
        if (a == null) {
            Log.w(TAG_TRIGGER, "stale alarm " + AlarmScheduler.shortId(id) + " (reminder removed), not ringing");
            return;
        }
        String owner = AlarmStore.owner(context);
        if (!a.test && !owner.isEmpty() && !owner.equals(a.userId)) {
            Log.w(TAG_TRIGGER, "alarm " + AlarmScheduler.shortId(id) + " belongs to another account, not ringing");
            return;
        }
        String state = AlarmStore.state(context, id, occurrence, a.time);
        if (state != null) {
            Log.i(TAG_TRIGGER, "occurrence already " + state + ", not ringing twice");
        } else if (late > AlarmScheduler.GRACE_MS) {
            Log.w(TAG_TRIGGER, "more than 10 minutes late (phone was off or restricted), skipping this ring");
        } else {
            AlarmStore.mark(context, id, occurrence, a.time, AlarmStore.STATE_RINGING);
            RingService.Alert alert = RingService.Alert.forReminder(a, occurrence, at);
            RingService.start(context, alert);
        }

        // Repeating reminders: set the next ring now (this one is in the ledger, so it's skipped).
        AlarmScheduler.schedule(context, a);
    }
}

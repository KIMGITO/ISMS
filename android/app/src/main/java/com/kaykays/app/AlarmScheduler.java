package com.kaykays.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/**
 * Sets each reminder as a real Android alarm, so it rings at its time with the app closed, the
 * screen locked, or no internet. The web app only hands over the list; nothing here depends on
 * the WebView being alive.
 *
 * Reminder times are Nairobi wall-clock times (the server's clock), so every alarm is worked
 * out in Africa/Nairobi. Changing the phone's time zone doesn't move a reminder; the receiver
 * still recalculates on TIME_SET / TIMEZONE_CHANGED because the phone's clock itself may jump.
 */
final class AlarmScheduler {

    static final String TAG_SCHEDULE = "ALARM_SCHEDULE";
    static final String ACTION_FIRE = "com.kaykays.app.ALARM_FIRE";
    static final String EXTRA_ID = "alarm_id";
    static final String EXTRA_OCCURRENCE = "alarm_occurrence";
    static final String EXTRA_AT = "alarm_at";

    /** Same grace as the server cron: an alarm missed by up to 10 minutes still rings. */
    static final long GRACE_MS = 10 * 60 * 1000L;
    static final TimeZone ZONE = TimeZone.getTimeZone("Africa/Nairobi");

    private AlarmScheduler() {}

    static final class Next {
        final long at;
        final String occurrence;

        Next(long at, String occurrence) {
            this.at = at;
            this.occurrence = occurrence;
        }
    }

    private static SimpleDateFormat dayFormat() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(ZONE);
        f.setLenient(false);
        return f;
    }

    /** The next time this alarm should ring that hasn't rung yet, or null if it never will again. */
    static Next next(Context c, AlarmStore.Alarm a, long now) {
        if (!a.isValid()) return null;
        SimpleDateFormat f = dayFormat();
        Calendar first = Calendar.getInstance(ZONE, Locale.US);
        try {
            first.setTime(f.parse(a.date));
        } catch (Exception e) {
            return null;
        }
        int hour = Integer.parseInt(a.time.substring(0, 2));
        int minute = Integer.parseInt(a.time.substring(3, 5));
        int firstDow = first.get(Calendar.DAY_OF_WEEK);
        int firstDom = first.get(Calendar.DAY_OF_MONTH);

        Calendar day = Calendar.getInstance(ZONE, Locale.US);
        day.setTimeInMillis(now);
        day.set(Calendar.HOUR_OF_DAY, 0);
        day.set(Calendar.MINUTE, 0);
        day.set(Calendar.SECOND, 0);
        day.set(Calendar.MILLISECOND, 0);
        day.add(Calendar.DAY_OF_MONTH, -1);

        for (int i = 0; i < 64; i++, day.add(Calendar.DAY_OF_MONTH, 1)) {
            String key = f.format(day.getTime());
            if (key.compareTo(a.date) < 0) continue;
            boolean matches;
            switch (a.repeat) {
                case "Daily": matches = true; break;
                case "Weekly": matches = day.get(Calendar.DAY_OF_WEEK) == firstDow; break;
                case "Monthly": matches = day.get(Calendar.DAY_OF_MONTH) == firstDom; break;
                default: matches = key.equals(a.date);
            }
            if (!matches) continue;
            // Already rung: by the server (any of this person's phones) or on this phone.
            if (key.equals(a.lastRemindedOn)) continue;
            if (AlarmStore.state(c, a.id, key, a.time) != null) continue;

            Calendar at = (Calendar) day.clone();
            at.set(Calendar.HOUR_OF_DAY, hour);
            at.set(Calendar.MINUTE, minute);
            long t = at.getTimeInMillis();
            if (t < now - GRACE_MS) continue;
            return new Next(t, key);
        }
        return null;
    }

    private static int requestCode(String id) {
        return 0x4B000000 ^ id.hashCode();
    }

    private static PendingIntent fireIntent(Context c, String id, String occurrence, long at, int flags) {
        Intent i = new Intent(c, AlarmReceiver.class)
            .setAction(ACTION_FIRE)
            // The data makes each reminder's alarm its own, so setting it again replaces it.
            .setData(Uri.parse("kaykays-alarm://reminder/" + id))
            .putExtra(EXTRA_ID, id)
            .putExtra(EXTRA_OCCURRENCE, occurrence)
            .putExtra(EXTRA_AT, at);
        return PendingIntent.getBroadcast(c, requestCode(id), i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Whether Android lets this app set exact alarms (always true before Android 12). */
    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    /** Sets (or replaces) the alarm for this reminder's next ring. Returns when it will ring, or 0. */
    static long schedule(Context c, AlarmStore.Alarm a) {
        cancel(c, a.id);
        long now = System.currentTimeMillis();
        Next n = next(c, a, now);
        if (n == null) {
            Log.i(TAG_SCHEDULE, "no further rings for " + shortId(a.id) + " (repeat=" + a.repeat + ")");
            return 0;
        }
        // Past due within the grace period: ring now. It still goes through AlarmManager, so it
        // is safe to call from boot, where Android forbids starting the ringing service directly.
        long at = Math.max(n.at, now + 1500);
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent fire = fireIntent(c, a.id, n.occurrence, n.at, PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact = canExact(c);
        try {
            if (exact) {
                // An alarm clock: exact, allowed in Doze, and shown as the phone's next alarm.
                PendingIntent show = PendingIntent.getActivity(c, 0,
                    new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), fire);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
            }
        } catch (SecurityException e) {
            exact = false;
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
        }
        Log.i(TAG_SCHEDULE, "set " + shortId(a.id) + " occurrence=" + n.occurrence + " at=" + iso(at)
            + " exact=" + exact + (n.at < now ? " (past due, ringing now)" : ""));
        return at;
    }

    static void cancel(Context c, String id) {
        PendingIntent pi = fireIntent(c, id, "", 0, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            c.getSystemService(AlarmManager.class).cancel(pi);
            pi.cancel();
            Log.i(TAG_SCHEDULE, "cancelled " + shortId(id));
        }
    }

    /** Sets every saved alarm again: after a reboot, an update, a clock change or a permission change. */
    static void rescheduleAll(Context c, String reason) {
        List<AlarmStore.Alarm> all = AlarmStore.all(c);
        String today = dayFormat().format(new java.util.Date());
        int set = 0;
        for (AlarmStore.Alarm a : all) {
            if (schedule(c, a) > 0) {
                set++;
            } else if ("None".equals(a.repeat) && a.date.compareTo(today) < 0) {
                AlarmStore.remove(c, a.id); // a one-off that is over
            }
        }
        Log.i(TAG_SCHEDULE, "rescheduled " + set + "/" + all.size() + " after " + reason);
    }

    /**
     * The full list of this person's reminders from the server. Alarms not in it are removed
     * (deleted, done, or moved to someone else). Test alarms set from Settings stay.
     */
    static int replaceAll(Context c, String ownerId, List<AlarmStore.Alarm> fresh) {
        String previousOwner = AlarmStore.owner(c);
        Set<String> keep = new HashSet<>();
        List<AlarmStore.Alarm> next = new ArrayList<>();
        for (AlarmStore.Alarm a : fresh) {
            if (!a.isValid()) continue;
            if (a.userId.isEmpty()) a.userId = ownerId;
            keep.add(a.id);
            next.add(a);
        }
        for (AlarmStore.Alarm old : AlarmStore.all(c)) {
            if (old.test && ownerId.equals(previousOwner)) {
                keep.add(old.id);
                next.add(old);
            } else if (!keep.contains(old.id)) {
                cancel(c, old.id);
                Log.i(TAG_SCHEDULE, "removed " + shortId(old.id) + " (no longer this person's)");
            }
        }
        AlarmStore.setOwner(c, ownerId);
        AlarmStore.replaceAll(c, next);
        int set = 0;
        for (AlarmStore.Alarm a : next) if (schedule(c, a) > 0) set++;
        Log.i("REMINDER_SYNC", "phone has " + next.size() + " reminder(s), " + set + " with a ring ahead");
        return set;
    }

    /** Sign-out: cancels every alarm and forgets them. */
    static void clearAll(Context c) {
        for (AlarmStore.Alarm a : AlarmStore.all(c)) cancel(c, a.id);
        AlarmStore.clear(c);
        Log.i(TAG_SCHEDULE, "cleared all alarms (signed out)");
    }

    /** The soonest ring among saved alarms, or 0. */
    static long soonest(Context c) {
        long now = System.currentTimeMillis();
        long best = 0;
        for (AlarmStore.Alarm a : AlarmStore.all(c)) {
            Next n = next(c, a, now);
            if (n != null && (best == 0 || n.at < best)) best = n.at;
        }
        return best;
    }

    static String shortId(String id) {
        return id == null ? "?" : id.length() > 8 ? id.substring(0, 8) : id;
    }

    static String iso(long t) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US);
        f.setTimeZone(ZONE);
        return f.format(new java.util.Date(t));
    }

    /** "1:38 PM", as the app shows times. */
    static String clock(long t) {
        SimpleDateFormat f = new SimpleDateFormat("h:mm a", Locale.US);
        f.setTimeZone(ZONE);
        return f.format(new java.util.Date(t));
    }
}

package com.kaykays.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Rings like an alarm clock until each alert is accepted. Runs as a foreground service so the
 * sound keeps going with the app closed and the screen off. Accept is the only way to stop it
 * (the person's rule: no snooze); dismissing the notification brings it straight back.
 *
 * Alerts come from two places, and one reminder never rings twice:
 *  - the phone's own alarm (AlarmReceiver), keyed by schedule id and day;
 *  - a push from the server (RingingMessagingService). A reminder push carries the same schedule
 *    id and day, so it joins the alarm that is already ringing instead of starting another.
 */
public class RingService extends Service {

    private static final String TAG = "RingService";
    private static final String TAG_SOUND = "ALARM_SOUND";
    private static final String TAG_DISMISS = "ALARM_DISMISS";
    static final String CHANNEL_ID = "ringing_alerts";
    private static final int NOTIFICATION_ID = 47001;

    static final String ACTION_RING = "com.kaykays.app.RING";
    static final String ACTION_CANCEL = "com.kaykays.app.RING_CANCEL";
    static final String ACTION_REPOST = "com.kaykays.app.RING_REPOST";
    static final String ACTION_ACCEPT = "com.kaykays.app.RING_ACCEPT";

    static final String EXTRA_ID = "ring_id";
    static final String EXTRA_TARGET = "ring_target";
    static final String EXTRA_BUSINESS = "ring_business";

    private static final String PREFS = "ring_alarm";
    private static final String PREF_TONE = "tone";
    private static final String PREF_ALERTS = "alerts";

    static final String APP_NAME = "Denso";

    public static final class Alert {
        /** "sched:<schedule id>:<day>" for reminders, otherwise the notification id. */
        final String key;
        /** The server's notification row, or "" until the server's push for it arrives. */
        String notificationId;
        final String title, body, target, businessId;
        final String scheduleId, occurrence;
        /** The reminder's time (HH:mm) for this ring; a moved reminder is a new ring. */
        final String time;
        final long scheduledAt;
        final boolean test;

        Alert(String key, String notificationId, String title, String body, String target, String businessId,
              String scheduleId, String occurrence, String time, long scheduledAt, boolean test) {
            this.key = key;
            this.notificationId = orEmpty(notificationId);
            this.title = orEmpty(title);
            this.body = orEmpty(body);
            this.target = orEmpty(target);
            this.businessId = orEmpty(businessId);
            this.scheduleId = orEmpty(scheduleId);
            this.occurrence = orEmpty(occurrence);
            this.time = orEmpty(time);
            this.scheduledAt = scheduledAt;
            this.test = test;
        }

        static String reminderKey(String scheduleId, String occurrence, String time) {
            return "sched:" + scheduleId + ":" + occurrence + ":" + orEmpty(time);
        }

        static Alert forReminder(AlarmStore.Alarm a, String occurrence, long at) {
            return new Alert(reminderKey(a.id, occurrence, a.time), "", a.title, a.notes, "dashboard", a.businessId,
                a.id, occurrence, a.time, at, a.test);
        }

        /** A ringing alert pushed by the server. */
        static Alert fromPush(String notificationId, String title, String body, String target, String businessId,
                              String scheduleId, String occurrence, String time) {
            boolean reminder = !orEmpty(scheduleId).isEmpty() && !orEmpty(occurrence).isEmpty();
            return new Alert(reminder ? reminderKey(scheduleId, occurrence, time) : notificationId, notificationId,
                title, body, target, businessId, scheduleId, occurrence, time, 0, false);
        }

        boolean isReminder() {
            return !scheduleId.isEmpty();
        }

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("key", key).put("nid", notificationId).put("title", title).put("body", body)
                    .put("target", target).put("business", businessId).put("sid", scheduleId)
                    .put("occ", occurrence).put("time", time).put("at", scheduledAt).put("test", test);
            } catch (Exception ignored) {
            }
            return o;
        }

        static Alert fromJson(JSONObject o) {
            return new Alert(o.optString("key"), o.optString("nid"), o.optString("title"), o.optString("body"),
                o.optString("target"), o.optString("business"), o.optString("sid"), o.optString("occ"),
                o.optString("time"), o.optLong("at"), o.optBoolean("test"));
        }

        /** What Accept hands the app: enough to accept on the server and open the right screen. */
        JSONObject acceptJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("id", notificationId).put("scheduleId", scheduleId).put("occurrence", occurrence).put("time", time)
                    .put("actionTarget", target).put("businessId", businessId).put("test", test);
            } catch (Exception ignored) {
            }
            return o;
        }
    }

    /** Alerts still ringing, oldest first. Guarded by itself; saved so a restart keeps ringing. */
    static final Map<String, Alert> alerts = new LinkedHashMap<>();
    private static boolean restored = false;

    /** The alarm screen listens so it can show the next alert or close. */
    interface Listener {
        void onAlertsChanged();
    }

    private static Listener listener;

    static void setListener(Listener l) {
        listener = l;
    }

    private static void changed(Context context) {
        save(context);
        Listener l = listener;
        if (l != null) new Handler(Looper.getMainLooper()).post(l::onAlertsChanged);
    }

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    // ---------------------------------------------------------------------------------------
    // Entry points
    // ---------------------------------------------------------------------------------------

    public static void start(Context context, Alert alert) {
        restore(context);
        synchronized (alerts) {
            Alert existing = alerts.get(alert.key);
            if (existing != null) {
                // Already ringing (the phone's alarm got there first): just remember the server row.
                if (existing.notificationId.isEmpty()) existing.notificationId = alert.notificationId;
                Log.i(TAG, "already ringing " + AlarmScheduler.shortId(alert.key) + ", joined the server alert");
                save(context);
                return;
            }
            alerts.put(alert.key, alert);
        }
        changed(context);
        Intent intent = new Intent(context, RingService.class).setAction(ACTION_RING);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            Log.i(TAG, "ringing " + (alert.isReminder() ? "reminder " + AlarmScheduler.shortId(alert.scheduleId)
                : "alert " + AlarmScheduler.shortId(alert.notificationId)));
        } catch (Exception e) {
            // Android refused to start the service from the background (for example, an inexact
            // alarm, or the high-priority push quota ran out). Fall back to a notification that
            // repeats its sound until it's opened.
            Log.w(TAG, "Could not start ringing service, posting a repeating notification", e);
            postFallback(context, alert);
        }
    }

    /** Whether this key or notification id is ringing now. */
    static boolean isRinging(Context context, String keyOrNotificationId) {
        restore(context);
        synchronized (alerts) {
            return find(keyOrNotificationId) != null;
        }
    }

    /** Stops an alert without accepting it (accepted on another phone, or no longer waiting). */
    public static void cancel(Context context, String keyOrNotificationId) {
        restore(context);
        Alert removed;
        synchronized (alerts) {
            removed = find(keyOrNotificationId);
            if (removed != null) alerts.remove(removed.key);
        }
        if (removed == null) return;
        Log.i(TAG_DISMISS, "stopped " + AlarmScheduler.shortId(removed.key) + " (handled elsewhere)");
        afterRemove(context, removed);
    }

    /**
     * The person tapped Accept. Stops the sound now and queues the accept for the app, which
     * sends it to the server (straight away if it's open, otherwise when it next opens).
     * Returns false if it had already been handled.
     */
    static boolean accept(Context context, String keyOrNotificationId) {
        restore(context);
        Alert removed;
        synchronized (alerts) {
            removed = find(keyOrNotificationId);
            if (removed != null) alerts.remove(removed.key);
        }
        if (removed == null) return false;
        if (removed.isReminder()) {
            AlarmStore.mark(context, removed.scheduleId, removed.occurrence, removed.time, AlarmStore.STATE_ACCEPTED);
        }
        AlarmStore.queueAccept(context, removed.acceptJson());
        Log.i(TAG_DISMISS, "accepted " + AlarmScheduler.shortId(removed.key));
        afterRemove(context, removed);
        return true;
    }

    private static void afterRemove(Context context, Alert removed) {
        context.getSystemService(NotificationManager.class).cancel(fallbackId(removed.key));
        changed(context);
        try {
            context.startService(new Intent(context, RingService.class).setAction(ACTION_CANCEL));
        } catch (Exception e) {
            // The service is not running, so nothing is ringing.
        }
    }

    private static Alert find(String keyOrNotificationId) {
        if (keyOrNotificationId == null || keyOrNotificationId.isEmpty()) return null;
        Alert a = alerts.get(keyOrNotificationId);
        if (a != null) return a;
        for (Alert x : alerts.values()) {
            if (keyOrNotificationId.equals(x.notificationId)) return x;
        }
        return null;
    }

    /** Keeps only these server alerts for a business; the rest were accepted elsewhere. */
    public static void keepOnly(Context context, String businessId, List<String> stillRinging) {
        restore(context);
        List<String> stale = new ArrayList<>();
        synchronized (alerts) {
            for (Alert a : alerts.values()) {
                // A phone-only alarm isn't on the server's list yet, so it is never "stale".
                if (a.notificationId.isEmpty()) continue;
                if (a.businessId.equals(businessId) && !stillRinging.contains(a.notificationId)) stale.add(a.key);
            }
        }
        for (String key : stale) cancel(context, key);
    }

    /** Saves the tone chosen in Settings: "alarm" for the phone's alarm sound, or a raw sound name. */
    public static void setTone(Context context, String sound) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(PREF_TONE, sound == null || sound.isEmpty() ? "alarm" : sound).apply();
    }

    public static List<String> ringingIds() {
        synchronized (alerts) {
            List<String> ids = new ArrayList<>();
            for (Alert a : alerts.values()) ids.add(a.notificationId.isEmpty() ? a.key : a.notificationId);
            return ids;
        }
    }

    /** The newest alert and how many are waiting, for the alarm screen. */
    static Alert latest() {
        synchronized (alerts) {
            Alert last = null;
            for (Alert a : alerts.values()) last = a;
            return last;
        }
    }

    static int count() {
        synchronized (alerts) {
            return alerts.size();
        }
    }

    // ---------------------------------------------------------------------------------------
    // Saved copy, so ringing survives Android restarting the service
    // ---------------------------------------------------------------------------------------

    private static void save(Context context) {
        JSONArray list = new JSONArray();
        synchronized (alerts) {
            for (Alert a : alerts.values()) list.put(a.toJson());
        }
        prefs(context).edit().putString(PREF_ALERTS, list.toString()).apply();
    }

    private static void restore(Context context) {
        synchronized (alerts) {
            if (restored) return;
            restored = true;
            try {
                JSONArray list = new JSONArray(prefs(context).getString(PREF_ALERTS, "[]"));
                for (int i = 0; i < list.length(); i++) {
                    Alert a = Alert.fromJson(list.getJSONObject(i));
                    if (!a.key.isEmpty() && !alerts.containsKey(a.key)) alerts.put(a.key, a);
                }
                if (list.length() > 0) Log.i(TAG, "restored " + list.length() + " ringing alert(s)");
            } catch (Exception ignored) {
            }
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------------------------------
    // Service
    // ---------------------------------------------------------------------------------------

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        restore(this);
        Alert current = latest();
        if (current == null) {
            // Must still enter the foreground once after startForegroundService, or Android
            // stops the app. Then stop straight away.
            enterForeground(buildNotification(this, new Alert("", "", "Alert", "", "", "", "", "", "", 0, false), 0));
            stopRinging();
            stopSelf();
            return START_NOT_STICKY;
        }

        enterForeground(buildNotification(this, current, count() - 1));
        startRinging();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void enterForeground(Notification notification) {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
    }

    private void startRinging() {
        if (player == null) {
            AudioManager audio = getSystemService(AudioManager.class);
            int volume = audio != null ? audio.getStreamVolume(AudioManager.STREAM_ALARM) : -1;
            int max = audio != null ? audio.getStreamMaxVolume(AudioManager.STREAM_ALARM) : -1;
            Uri tone = ringtone();
            player = new MediaPlayer();
            try {
                player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                player.setDataSource(this, tone);
                player.setLooping(true);
                player.prepare();
                player.start();
                Log.i(TAG_SOUND, "playing " + (tone.getScheme() + ":" + tone.getLastPathSegment())
                    + " on the alarm stream, volume " + volume + "/" + max
                    + (volume == 0 ? " (alarm volume is OFF: it will be silent)" : ""));
            } catch (Exception e) {
                Log.e(TAG_SOUND, "Could not play the ringing sound", e);
                player.release();
                player = null;
            }
        }

        if (vibrator == null) {
            vibrator = getSystemService(Vibrator.class);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 800, 600};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0),
                        new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        }

        if (wakeLock == null) {
            PowerManager pm = getSystemService(PowerManager.class);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kaykays:ringing");
            // Released on Accept; the limit only guards against a lock that is never released.
            wakeLock.acquire(12 * 60 * 60 * 1000L);
        }
    }

    private void stopRinging() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            player.release();
            player = null;
            Log.i(TAG_SOUND, "stopped");
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        if (wakeLock != null) {
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
        }
    }

    private Uri ringtone() {
        String tone = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_TONE, "alarm");
        if (tone != null && !"alarm".equals(tone)) {
            int res = getResources().getIdentifier(tone, "raw", getPackageName());
            if (res != 0) return Uri.parse("android.resource://" + getPackageName() + "/" + res);
        }
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (uri == null) uri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.notification1);
        return uri;
    }

    // ---------------------------------------------------------------------------------------
    // Notifications
    // ---------------------------------------------------------------------------------------

    static void ensureChannel(Context context) {
        NotificationChannels.ensure(context);
    }

    /** Opens the app on the alert's screen and accepts it. */
    static PendingIntent acceptIntent(Context context, Alert alert) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(ACTION_ACCEPT)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ID, alert.key)
            .putExtra(EXTRA_TARGET, alert.target)
            .putExtra(EXTRA_BUSINESS, alert.businessId);
        return PendingIntent.getActivity(context, alert.key.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The full-screen alarm screen. */
    static PendingIntent screenIntent(Context context) {
        Intent intent = new Intent(context, AlarmActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        return PendingIntent.getActivity(context, 47002, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** "Reminder from Denso" / "You have a reminder: Open the shop". */
    static String heading(Alert alert) {
        return alert.isReminder() ? "Reminder from " + APP_NAME : (alert.title.isEmpty() ? APP_NAME : alert.title);
    }

    static String line(Alert alert) {
        if (alert.isReminder()) return "You have a reminder: " + (alert.title.isEmpty() ? "Reminder" : alert.title);
        return alert.body;
    }

    private static Bitmap largeIcon;

    static synchronized Bitmap largeIcon(Context context) {
        if (largeIcon == null) {
            try {
                Drawable d = ContextCompat.getDrawable(context, R.drawable.ic_denso_large);
                int px = Math.round(64 * context.getResources().getDisplayMetrics().density);
                largeIcon = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
                d.setBounds(0, 0, px, px);
                d.draw(new Canvas(largeIcon));
            } catch (Exception e) {
                return null;
            }
        }
        return largeIcon;
    }

    /** Whether Android lets this app open the alarm screen over the lock screen. */
    static boolean canUseFullScreen(Context context) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        return nm != null && nm.canUseFullScreenIntent();
    }

    private static Notification buildNotification(Context context, Alert alert, int others) {
        ensureChannel(context);
        PendingIntent accept = acceptIntent(context, alert);
        PendingIntent screen = screenIntent(context);
        PendingIntent repost = PendingIntent.getService(context, 0,
            new Intent(context, RingService.class).setAction(ACTION_REPOST),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        StringBuilder big = new StringBuilder(line(alert));
        if (alert.isReminder() && !alert.body.isEmpty()) big.append("\n").append(alert.body);
        if (alert.scheduledAt > 0) big.append("\nSet for ").append(AlarmScheduler.clock(alert.scheduledAt));
        if (others > 0) big.append("\n+").append(others).append(" more waiting");

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_denso)
            .setLargeIcon(largeIcon(context))
            .setColor(0xFFF59E0B)
            .setContentTitle(heading(alert))
            .setContentText(line(alert))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(big.toString()))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(screen)
            .setDeleteIntent(repost)
            .addAction(0, "Accept", accept);
        if (alert.scheduledAt > 0) b.setWhen(alert.scheduledAt).setShowWhen(true);
        if (!alert.key.isEmpty()) {
            if (canUseFullScreen(context)) {
                b.setFullScreenIntent(screen, true);
            } else {
                // Android 14+ without full-screen access: a heads-up notification that still rings.
                Log.w("ALARM_TRIGGER", "full-screen intent not allowed; showing a heads-up notification instead");
            }
        }
        return b.build();
    }

    private static int fallbackId(String key) {
        return 47100 + Math.abs(key.hashCode() % 10000);
    }

    /** Used only when the service can't start: Android repeats the sound until it's opened. */
    private static void postFallback(Context context, Alert alert) {
        NotificationChannels.ensure(context);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, NotificationChannels.RING_FALLBACK)
            .setSmallIcon(R.drawable.ic_stat_denso)
            .setLargeIcon(largeIcon(context))
            .setColor(0xFFF59E0B)
            .setContentTitle(heading(alert))
            .setContentText(line(alert))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(screenIntent(context))
            .addAction(0, "Accept", acceptIntent(context, alert));
        if (canUseFullScreen(context)) b.setFullScreenIntent(screenIntent(context), true);
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT;
        context.getSystemService(NotificationManager.class).notify(fallbackId(alert.key), n);
    }

    private static String orEmpty(String s) {
        return s == null || "null".equals(s) ? "" : s;
    }
}

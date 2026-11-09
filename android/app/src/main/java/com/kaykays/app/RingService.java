package com.kaykays.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Rings like an alarm until each alert is accepted. Runs as a foreground service so the sound
 * keeps going with the app closed and the screen off. The only way to stop it is Accept, which
 * opens the app on the alert's screen; dismissing the notification brings it straight back.
 */
public class RingService extends Service {

    private static final String TAG = "RingService";
    static final String CHANNEL_ID = "ringing_alerts";
    private static final int NOTIFICATION_ID = 47001;

    static final String ACTION_RING = "com.kaykays.app.RING";
    static final String ACTION_CANCEL = "com.kaykays.app.RING_CANCEL";
    static final String ACTION_REPOST = "com.kaykays.app.RING_REPOST";
    static final String ACTION_ACCEPT = "com.kaykays.app.RING_ACCEPT";

    static final String EXTRA_ID = "ring_id";
    static final String EXTRA_TITLE = "ring_title";
    static final String EXTRA_BODY = "ring_body";
    static final String EXTRA_TARGET = "ring_target";
    static final String EXTRA_BUSINESS = "ring_business";

    public static final class Alert {
        final String id, title, body, target, businessId;

        Alert(String id, String title, String body, String target, String businessId) {
            this.id = id;
            this.title = title;
            this.body = body;
            this.target = target;
            this.businessId = businessId;
        }
    }

    /** Alerts still ringing, oldest first. Shared with RingAlarmPlugin; guarded by itself. */
    static final Map<String, Alert> alerts = new LinkedHashMap<>();

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    // ---------------------------------------------------------------------------------------
    // Entry points
    // ---------------------------------------------------------------------------------------

    public static void start(Context context, Alert alert) {
        Intent intent = new Intent(context, RingService.class).setAction(ACTION_RING)
            .putExtra(EXTRA_ID, alert.id)
            .putExtra(EXTRA_TITLE, alert.title)
            .putExtra(EXTRA_BODY, alert.body)
            .putExtra(EXTRA_TARGET, alert.target)
            .putExtra(EXTRA_BUSINESS, alert.businessId);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            // Android refused to start the service from the background (for example, the high
            // priority push quota ran out). Fall back to a notification that repeats its sound.
            Log.w(TAG, "Could not start ringing service, posting a repeating notification", e);
            synchronized (alerts) {
                alerts.put(alert.id, alert);
            }
            postFallback(context, alert);
        }
    }

    public static void cancel(Context context, String id) {
        boolean wasRinging;
        synchronized (alerts) {
            wasRinging = alerts.remove(id) != null;
        }
        if (!wasRinging) return;
        context.getSystemService(NotificationManager.class).cancel(fallbackId(id));
        try {
            context.startService(new Intent(context, RingService.class).setAction(ACTION_CANCEL));
        } catch (Exception e) {
            // The service is not running, so nothing is ringing.
        }
    }

    /** Keeps only these alerts for a business; the rest were accepted elsewhere. */
    public static void keepOnly(Context context, String businessId, List<String> stillRinging) {
        List<String> stale = new ArrayList<>();
        synchronized (alerts) {
            for (Alert a : alerts.values()) {
                if (a.businessId.equals(businessId) && !stillRinging.contains(a.id)) stale.add(a.id);
            }
        }
        for (String id : stale) cancel(context, id);
    }

    public static List<String> ringingIds() {
        synchronized (alerts) {
            return new ArrayList<>(alerts.keySet());
        }
    }

    // ---------------------------------------------------------------------------------------
    // Service
    // ---------------------------------------------------------------------------------------

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_RING.equals(action)) {
            Alert alert = new Alert(
                intent.getStringExtra(EXTRA_ID),
                intent.getStringExtra(EXTRA_TITLE),
                intent.getStringExtra(EXTRA_BODY),
                intent.getStringExtra(EXTRA_TARGET),
                intent.getStringExtra(EXTRA_BUSINESS));
            synchronized (alerts) {
                alerts.put(alert.id, alert);
            }
        }

        Alert current = latest();
        if (current == null) {
            // Must still enter the foreground once after startForegroundService, or Android
            // stops the app. Then stop straight away.
            enterForeground(buildNotification(this, new Alert("", "Alert", "", "", ""), 0));
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
            player = new MediaPlayer();
            try {
                player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                player.setDataSource(this, ringtone());
                player.setLooping(true);
                player.prepare();
                player.start();
            } catch (Exception e) {
                Log.e(TAG, "Could not play the ringing sound", e);
                player.release();
                player = null;
            }
        }

        if (vibrator == null) {
            vibrator = getSystemService(Vibrator.class);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 800, 600};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
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
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (uri == null) uri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.notification1);
        return uri;
    }

    private static Alert latest() {
        synchronized (alerts) {
            Alert last = null;
            for (Alert a : alerts.values()) last = a;
            return last;
        }
    }

    private static int count() {
        synchronized (alerts) {
            return alerts.size();
        }
    }

    // ---------------------------------------------------------------------------------------
    // Notifications
    // ---------------------------------------------------------------------------------------

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Ringing alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Shift reminders and urgent alerts that ring until you accept them");
        // The service plays the sound itself, so it can loop.
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }

    /** Opens the app on the alert's screen and accepts it. */
    static PendingIntent acceptIntent(Context context, Alert alert) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(ACTION_ACCEPT)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ID, alert.id)
            .putExtra(EXTRA_TARGET, alert.target)
            .putExtra(EXTRA_BUSINESS, alert.businessId);
        return PendingIntent.getActivity(context, alert.id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Notification buildNotification(Context context, Alert alert, int others) {
        ensureChannel(context);
        PendingIntent accept = acceptIntent(context, alert);
        PendingIntent repost = PendingIntent.getService(context, 0,
            new Intent(context, RingService.class).setAction(ACTION_REPOST),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String body = alert.body;
        if (others > 0) body = body + (body.isEmpty() ? "" : "\n") + "+" + others + " more waiting";

        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_name)
            .setColor(0xFFF59E0B)
            .setContentTitle(alert.title)
            .setContentText(alert.body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(accept)
            .setFullScreenIntent(accept, true)
            .setDeleteIntent(repost)
            .addAction(0, "Accept", accept)
            .build();
    }

    private static int fallbackId(String id) {
        return 47100 + Math.abs(id.hashCode() % 10000);
    }

    /** Used only when the service can't start: Android repeats the sound until it's opened. */
    private static void postFallback(Context context, Alert alert) {
        ensureFallbackChannel(context);
        Notification n = new NotificationCompat.Builder(context, "ringing_alerts_fallback")
            .setSmallIcon(R.drawable.ic_stat_name)
            .setColor(0xFFF59E0B)
            .setContentTitle(alert.title)
            .setContentText(alert.body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(acceptIntent(context, alert))
            .setFullScreenIntent(acceptIntent(context, alert), true)
            .addAction(0, "Accept", acceptIntent(context, alert))
            .build();
        n.flags |= Notification.FLAG_INSISTENT;
        context.getSystemService(NotificationManager.class).notify(fallbackId(alert.id), n);
    }

    private static void ensureFallbackChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel("ringing_alerts_fallback") != null) return;
        NotificationChannel channel = new NotificationChannel(
            "ringing_alerts_fallback", "Ringing alerts (backup)", NotificationManager.IMPORTANCE_HIGH);
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }
}

package com.kaykays.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

/**
 * Every notification channel the app uses, created natively at start-up. Pushes that arrive
 * before the web app has ever run (or after Android killed it) still land in the right channel
 * with the right importance, instead of Android's "Miscellaneous".
 *
 * Android fixes a channel's importance and sound when it is first created; later calls only
 * update names. The same ids are used by send-fcm (channel_id "default") and the web app.
 */
final class NotificationChannels {

    static final String DEFAULT = "default";
    static final String ALERTS = "alerts";
    static final String SHIFTS = "shifts";
    static final String RING = RingService.CHANNEL_ID;
    static final String RING_FALLBACK = "ringing_alerts_fallback";

    private NotificationChannels() {}

    static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel general = new NotificationChannel(DEFAULT, "General notifications",
            NotificationManager.IMPORTANCE_DEFAULT);
        general.setDescription("Stock, sales, payments and other updates");
        nm.createNotificationChannel(general);

        NotificationChannel alerts = new NotificationChannel(ALERTS, "Important alerts",
            NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Security and out-of-stock alerts");
        nm.createNotificationChannel(alerts);

        NotificationChannel shifts = new NotificationChannel(SHIFTS, "Shift notifications",
            NotificationManager.IMPORTANCE_HIGH);
        shifts.setDescription("Shift open and close reports");
        nm.createNotificationChannel(shifts);

        NotificationChannel ring = new NotificationChannel(RING, "Alarms and ringing alerts",
            NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Reminders and urgent alerts that ring until you accept them");
        // The ringing service plays the sound and vibrates itself, so it can loop.
        ring.setSound(null, null);
        ring.enableVibration(false);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ring);

        NotificationChannel fallback = new NotificationChannel(RING_FALLBACK, "Alarms (backup)",
            NotificationManager.IMPORTANCE_HIGH);
        fallback.setDescription("Used when Android won't let the ringing service start");
        fallback.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        fallback.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(fallback);
    }

    /** Whether the person has switched a channel off in Android Settings. */
    static boolean enabled(Context context, String id) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        NotificationChannel ch = nm == null ? null : nm.getNotificationChannel(id);
        return ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
}

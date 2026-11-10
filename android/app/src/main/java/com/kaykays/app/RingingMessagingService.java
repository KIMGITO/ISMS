package com.kaykays.app;

import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONObject;

/**
 * Receives every push, natively, so nothing here needs the web app to be running:
 *  - alarm_upsert / alarm_cancel: a reminder was set, changed, moved or deleted. The phone sets
 *    or removes its own alarm, which then rings on time even without internet.
 *  - ring / ring_cancel: the server's ringing alert (the backup when the phone had no alarm).
 * Everything else goes to the Capacitor push plugin as before.
 *
 * Replaces the plugin's own service in AndroidManifest.xml, because Android delivers each push
 * to only one service.
 */
public class RingingMessagingService extends MessagingService {

    private static final String TAG = "FCM_RECEIVED";
    private static final String TAG_SYNC = "REMINDER_SYNC";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String kind = data.get("kind");
        Log.i(TAG, "kind=" + (kind == null ? "notification" : kind)
            + " priority=" + remoteMessage.getPriority() + "/" + remoteMessage.getOriginalPriority()
            + " sent_ms_ago=" + (System.currentTimeMillis() - remoteMessage.getSentTime()));

        if ("alarm_upsert".equals(kind)) {
            onAlarmUpsert(data);
            return;
        }
        if ("alarm_cancel".equals(kind)) {
            String id = data.get("id");
            if (id != null && !id.isEmpty()) {
                AlarmScheduler.cancel(this, id);
                AlarmStore.remove(this, id);
                Log.i(TAG_SYNC, "removed " + AlarmScheduler.shortId(id) + " from this phone");
            }
            return;
        }
        if ("ring".equals(kind)) {
            onRing(data);
            return;
        }
        if ("ring_cancel".equals(kind)) {
            String id = data.get("notification_id");
            if (id != null) RingService.cancel(this, id);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // The web app saves it to the server the next time it opens (it calls register() on start).
        AlarmStore.setToken(this, token);
        Log.i("PUSH_REGISTRATION", "new FCM token issued");
        super.onNewToken(token);
    }

    private void onAlarmUpsert(Map<String, String> data) {
        AlarmStore.Alarm a = AlarmStore.Alarm.fromJson(new JSONObject(data));
        if (!a.isValid()) {
            Log.w(TAG_SYNC, "ignored a reminder with missing fields");
            return;
        }
        String owner = AlarmStore.owner(this);
        if (!owner.isEmpty() && !owner.equals(a.userId)) {
            // This phone is signed in as someone else now; their token should have moved already.
            Log.w(TAG_SYNC, "ignored reminder " + AlarmScheduler.shortId(a.id) + " for another account");
            return;
        }
        if (owner.isEmpty()) {
            // Signed out on this phone: no alarms until someone signs in and syncs.
            Log.w(TAG_SYNC, "ignored reminder " + AlarmScheduler.shortId(a.id) + ": nobody signed in on this phone");
            return;
        }
        AlarmStore.Alarm old = AlarmStore.get(this, a.id);
        if (old != null && !old.updatedAt.isEmpty() && !a.updatedAt.isEmpty() && a.updatedAt.compareTo(old.updatedAt) < 0) {
            Log.i(TAG_SYNC, "ignored an older copy of " + AlarmScheduler.shortId(a.id));
            return;
        }
        AlarmStore.put(this, a);
        long at = AlarmScheduler.schedule(this, a);
        Log.i(TAG_SYNC, "saved " + AlarmScheduler.shortId(a.id) + (at > 0 ? " next ring " + AlarmScheduler.iso(at) : " (nothing ahead)"));
    }

    private void onRing(Map<String, String> data) {
        String id = data.get("notification_id");
        if (id == null || id.isEmpty()) return;
        String scheduleId = data.get("schedule_id");
        String occurrence = data.get("occurrence");
        RingService.Alert alert = RingService.Alert.fromPush(id, data.get("title"), data.get("body"),
            data.get("action_target"), data.get("business_id"), scheduleId, occurrence, data.get("start_time"));

        if (alert.isReminder()) {
            String state = AlarmStore.state(this, alert.scheduleId, alert.occurrence, alert.time);
            if (AlarmStore.STATE_ACCEPTED.equals(state)) {
                // Accepted on this phone before the server's copy arrived: accept that copy too.
                AlarmStore.queueAccept(this, alert.acceptJson());
                RingAlarmPlugin.flush(this);
                Log.i(TAG, "server reminder " + AlarmScheduler.shortId(alert.scheduleId) + " already accepted here");
                return;
            }
            if (RingService.isRinging(this, alert.key)) {
                RingService.start(this, alert); // joins the ringing alarm, no second sound
                return;
            }
            Log.i(TAG, "server reminder " + AlarmScheduler.shortId(alert.scheduleId)
                + (state == null ? " had no alarm on this phone: ringing from the push (backup)" : " ringing again"));
            AlarmStore.mark(this, alert.scheduleId, alert.occurrence, alert.time, AlarmStore.STATE_RINGING);
        }
        RingService.start(this, alert);
    }
}

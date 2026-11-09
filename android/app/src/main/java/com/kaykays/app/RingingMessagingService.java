package com.kaykays.app;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Receives every push. Ringing alerts and their cancellations are handled here, so they work
 * when the app is closed. Everything else goes to the Capacitor push plugin as before.
 *
 * Replaces the plugin's own service in AndroidManifest.xml, because Android delivers each push
 * to only one service.
 */
public class RingingMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String kind = data.get("kind");
        String id = data.get("notification_id");

        if ("ring".equals(kind) && id != null && !id.isEmpty()) {
            RingService.start(this, new RingService.Alert(
                id,
                orEmpty(data.get("title")),
                orEmpty(data.get("body")),
                orEmpty(data.get("action_target")),
                orEmpty(data.get("business_id"))
            ));
            return;
        }
        if ("ring_cancel".equals(kind) && id != null) {
            RingService.cancel(this, id);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}

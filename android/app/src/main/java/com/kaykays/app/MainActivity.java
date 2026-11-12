package com.kaykays.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothSerialPlugin.class);
        registerPlugin(NetworkPrinterPlugin.class);
        registerPlugin(ReceiptMailPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(PushSupportPlugin.class);
        registerPlugin(ScreenOrientationPlugin.class);
        registerPlugin(RingAlarmPlugin.class);
        registerPlugin(AlarmSchedulerPlugin.class);
        registerPlugin(SubjectSegmentationPlugin.class);
        super.onCreate(savedInstanceState);
        handleRingAccept(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRingAccept(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Accept taps made while the app was closed or in the background.
        RingAlarmPlugin.flush(this);
    }

    /** Accept on a ringing alert: stop the sound now, then let the app accept it and open its screen. */
    private void handleRingAccept(Intent intent) {
        if (intent == null || !RingService.ACTION_ACCEPT.equals(intent.getAction())) return;
        String id = intent.getStringExtra(RingService.EXTRA_ID);
        // Saves the accept for the app; a no-op if the alarm screen already did.
        if (id != null) RingService.accept(this, id);
        // Don't handle the same tap twice if the activity is recreated.
        intent.setAction(Intent.ACTION_MAIN);
        RingAlarmPlugin.flush(this);
    }
}

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
        super.onCreate(savedInstanceState);
        handleRingAccept(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRingAccept(intent);
    }

    /** Accept on a ringing alert: stop the sound now, then let the app accept it and open its screen. */
    private void handleRingAccept(Intent intent) {
        if (intent == null || !RingService.ACTION_ACCEPT.equals(intent.getAction())) return;
        String id = intent.getStringExtra(RingService.EXTRA_ID);
        if (id != null) RingService.cancel(this, id);
        RingAlarmPlugin.deliverAccept(intent);
    }
}

package com.kaykays.app;

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
        super.onCreate(savedInstanceState);
    }
}

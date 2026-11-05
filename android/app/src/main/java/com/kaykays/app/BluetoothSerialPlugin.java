package com.kaykays.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Classic Bluetooth (RFCOMM/SPP) link for ESC/POS thermal receipt printers.
 * Printers are paired once in Android settings and then appear in list().
 */
@SuppressLint("MissingPermission") // Every entry point runs after ensureAccess or fails with a catchable error.
@CapacitorPlugin(
    name = "BluetoothSerial",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN })
    }
)
public class BluetoothSerialPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    // One thread keeps connect, write and disconnect in order and off the UI thread.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private BluetoothSocket socket;
    private OutputStream output;

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    @PluginMethod
    public void ensureAccess(PluginCall call) {
        // Before Android 12 these are install-time permissions.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == PermissionState.GRANTED) {
            resolveGranted(call, true);
        } else {
            requestPermissionForAlias("bluetooth", call, "accessCallback");
        }
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        resolveGranted(call, getPermissionState("bluetooth") == PermissionState.GRANTED);
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        JSObject result = new JSObject();
        result.put("value", adapter != null && adapter.isEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void list(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This device has no Bluetooth.");
            return;
        }
        try {
            JSArray devices = new JSArray();
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                JSObject item = new JSObject();
                item.put("name", device.getName());
                item.put("address", device.getAddress());
                devices.put(item);
            }
            JSObject result = new JSObject();
            result.put("list", devices);
            call.resolve(result);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission was not granted.");
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        BluetoothAdapter adapter = adapter();
        if (address == null || adapter == null) {
            call.reject("Bluetooth is not available.");
            return;
        }
        worker.execute(() -> {
            closeQuietly();
            try {
                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                socket = openSocket(device);
                output = socket.getOutputStream();
                call.resolve();
            } catch (IOException | SecurityException | IllegalArgumentException e) {
                closeQuietly();
                call.reject("Could not connect to the printer. Check that it is on and paired.");
            }
        });
    }

    // Many low-cost printers only accept the insecure channel.
    private BluetoothSocket openSocket(BluetoothDevice device) throws IOException {
        try {
            BluetoothSocket secure = device.createRfcommSocketToServiceRecord(SPP_UUID);
            secure.connect();
            return secure;
        } catch (IOException secureFailure) {
            BluetoothSocket insecure = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            insecure.connect();
            return insecure;
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String value = call.getString("value");
        if (value == null) {
            call.reject("Nothing to print.");
            return;
        }
        worker.execute(() -> {
            if (output == null) {
                call.reject("The printer is not connected.");
                return;
            }
            try {
                output.write(Base64.decode(value, Base64.DEFAULT));
                output.flush();
                call.resolve();
            } catch (IOException e) {
                closeQuietly();
                call.reject("The printer connection was lost.");
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        worker.execute(() -> {
            closeQuietly();
            call.resolve();
        });
    }

    private void closeQuietly() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
            // The socket is being discarded either way.
        }
        socket = null;
        output = null;
    }

    @Override
    protected void handleOnDestroy() {
        worker.execute(this::closeQuietly);
        worker.shutdown();
    }
}

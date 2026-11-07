package com.kaykays.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Classic Bluetooth (RFCOMM/SPP) link for ESC/POS thermal receipt printers.
 * list() returns paired devices; discover() also finds printers in range that are not paired yet.
 */
@SuppressLint("MissingPermission") // Every entry point runs after ensureAccess or fails with a catchable error.
@CapacitorPlugin(
    name = "BluetoothSerial",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN }),
        // Before Android 12, finding devices in range needs location access.
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class BluetoothSerialPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int MAX_DISCOVERY_MS = 20000;

    // One thread keeps connect, write and disconnect in order and off the UI thread.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private BluetoothSocket socket;
    private OutputStream output;
    private String connectedAddress;

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    @PluginMethod
    public void ensureAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetooth") == PermissionState.GRANTED) {
                resolveGranted(call, true);
            } else {
                requestPermissionForAlias("bluetooth", call, "accessCallback");
            }
        } else if (getPermissionState("location") == PermissionState.GRANTED) {
            resolveGranted(call, true);
        } else {
            requestPermissionForAlias("location", call, "accessCallback");
        }
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        String alias = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "location";
        resolveGranted(call, getPermissionState(alias) == PermissionState.GRANTED);
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

    private static boolean looksLikePrinter(BluetoothDevice device) {
        BluetoothClass btClass = device.getBluetoothClass();
        if (btClass == null) return false;
        return btClass.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING;
    }

    private JSObject describe(BluetoothDevice device, boolean inRange) {
        JSObject item = new JSObject();
        item.put("name", device.getName());
        item.put("address", device.getAddress());
        item.put("paired", device.getBondState() == BluetoothDevice.BOND_BONDED);
        item.put("inRange", inRange);
        item.put("isPrinter", looksLikePrinter(device));
        item.put("connected", device.getAddress().equals(connectedAddress) && socket != null && socket.isConnected());
        return item;
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
                devices.put(describe(device, false));
            }
            JSObject result = new JSObject();
            result.put("list", devices);
            call.resolve(result);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission was not granted.");
        }
    }

    /**
     * Searches for nearby devices for timeoutMs, then returns paired devices plus everything found.
     * Paired printers that are switched off are still returned (inRange false) so the cashier can see them.
     */
    @PluginMethod
    public void discover(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This device has no Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is turned off. Turn it on and search again.");
            return;
        }
        int timeoutMs = Math.max(3000, Math.min(MAX_DISCOVERY_MS, call.getInt("timeoutMs", 8000)));
        Map<String, JSObject> found = new LinkedHashMap<>();
        Map<String, BluetoothDevice> seen = new LinkedHashMap<>();

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device != null) seen.put(device.getAddress(), device);
                }
            }
        };

        try {
            getContext().registerReceiver(receiver, new IntentFilter(BluetoothDevice.ACTION_FOUND));
            adapter.cancelDiscovery();
            boolean started = adapter.startDiscovery();
            if (!started) {
                getContext().unregisterReceiver(receiver);
                call.reject("Could not search for Bluetooth devices. Check that Bluetooth and location are on.");
                return;
            }
        } catch (SecurityException e) {
            call.reject("Bluetooth permission was not granted.");
            return;
        }

        main.postDelayed(() -> {
            try {
                adapter.cancelDiscovery();
            } catch (SecurityException ignored) {
                // Discovery stops by itself after about 12 seconds.
            }
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered.
            }
            try {
                for (BluetoothDevice device : adapter.getBondedDevices()) {
                    found.put(device.getAddress(), describe(device, seen.containsKey(device.getAddress())));
                }
                for (BluetoothDevice device : seen.values()) {
                    if (!found.containsKey(device.getAddress())) found.put(device.getAddress(), describe(device, true));
                }
                JSArray devices = new JSArray();
                for (JSObject item : found.values()) devices.put(item);
                JSObject result = new JSObject();
                result.put("list", devices);
                call.resolve(result);
            } catch (SecurityException e) {
                call.reject("Bluetooth permission was not granted.");
            }
        }, timeoutMs);
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
            if (address.equals(connectedAddress) && socket != null && socket.isConnected()) {
                call.resolve();
                return;
            }
            closeQuietly();
            try {
                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                socket = openSocket(device);
                output = socket.getOutputStream();
                connectedAddress = address;
                call.resolve();
            } catch (IOException | SecurityException | IllegalArgumentException e) {
                closeQuietly();
                call.reject("Could not connect to the printer. Check that it is on, nearby and not in use by another phone.");
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
                byte[] bytes = Base64.decode(value, Base64.DEFAULT);
                // Small chunks keep cheap printers from dropping data when their buffer fills.
                int chunk = 512;
                for (int offset = 0; offset < bytes.length; offset += chunk) {
                    output.write(bytes, offset, Math.min(chunk, bytes.length - offset));
                    output.flush();
                    Thread.sleep(20);
                }
                call.resolve();
            } catch (IOException e) {
                closeQuietly();
                call.reject("The printer connection was lost.");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                call.reject("Printing was interrupted.");
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
        connectedAddress = null;
    }

    @Override
    protected void handleOnDestroy() {
        worker.execute(this::closeQuietly);
        worker.shutdown();
    }
}

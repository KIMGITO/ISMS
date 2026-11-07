package com.kaykays.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Wi-Fi / LAN ESC/POS printers ("raw" printing on TCP port 9100).
 * scan() checks every address on the phone's Wi-Fi subnet for an open printer port.
 */
@CapacitorPlugin(name = "NetworkPrinter")
public class NetworkPrinterPlugin extends Plugin {

    private final ExecutorService jobs = Executors.newCachedThreadPool();

    private Inet4Address wifiAddress(int[] prefixOut) {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return null;
        for (Network network : cm.getAllNetworks()) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (caps == null) continue;
            boolean local = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
            if (!local) continue;
            LinkProperties props = cm.getLinkProperties(network);
            if (props == null) continue;
            for (LinkAddress link : props.getLinkAddresses()) {
                if (link.getAddress() instanceof Inet4Address) {
                    prefixOut[0] = link.getPrefixLength();
                    return (Inet4Address) link.getAddress();
                }
            }
        }
        return null;
    }

    private static boolean portOpen(String host, int port, int timeoutMs) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    @PluginMethod
    public void scan(PluginCall call) {
        int port = call.getInt("port", 9100);
        int timeoutMs = Math.max(150, Math.min(2000, call.getInt("timeoutMs", 400)));
        jobs.execute(() -> {
            int[] prefix = new int[] { 24 };
            Inet4Address self = wifiAddress(prefix);
            if (self == null) {
                call.reject("Connect this phone to the same Wi-Fi as the printer, then search again.");
                return;
            }
            byte[] raw = self.getAddress();
            // Larger networks are capped to the phone's own /24 so a scan stays under a few seconds.
            String base = (raw[0] & 0xff) + "." + (raw[1] & 0xff) + "." + (raw[2] & 0xff) + ".";
            int own = raw[3] & 0xff;
            ExecutorService pool = Executors.newFixedThreadPool(48);
            List<Future<String>> checks = new ArrayList<>();
            for (int i = 1; i < 255; i++) {
                if (i == own) continue;
                final String host = base + i;
                checks.add(pool.submit(() -> portOpen(host, port, timeoutMs) ? host : null));
            }
            List<String> hosts = new ArrayList<>();
            for (Future<String> check : checks) {
                try {
                    String host = check.get(timeoutMs + 2000L, TimeUnit.MILLISECONDS);
                    if (host != null) hosts.add(host);
                } catch (Exception ignored) {
                    // An address that does not answer in time is not a printer we can use.
                }
            }
            pool.shutdownNow();
            Collections.sort(hosts, (a, b) -> Integer.compare(lastOctet(a), lastOctet(b)));
            JSArray list = new JSArray();
            for (String host : hosts) {
                JSObject item = new JSObject();
                item.put("host", host);
                item.put("port", port);
                item.put("name", resolveName(host));
                list.put(item);
            }
            JSObject result = new JSObject();
            result.put("list", list);
            result.put("subnet", base + "0/" + Math.max(prefix[0], 24));
            call.resolve(result);
        });
    }

    private static int lastOctet(String host) {
        return Integer.parseInt(host.substring(host.lastIndexOf('.') + 1));
    }

    private static String resolveName(String host) {
        try {
            String name = InetAddress.getByName(host).getCanonicalHostName();
            return name.equals(host) ? null : name;
        } catch (IOException e) {
            return null;
        }
    }

    @PluginMethod
    public void probe(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 9100);
        int timeoutMs = Math.max(150, Math.min(5000, call.getInt("timeoutMs", 1500)));
        if (host == null || host.trim().isEmpty()) {
            call.reject("Enter the printer's IP address.");
            return;
        }
        jobs.execute(() -> {
            JSObject result = new JSObject();
            result.put("reachable", portOpen(host.trim(), port, timeoutMs));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void send(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 9100);
        String value = call.getString("value");
        if (host == null || value == null) {
            call.reject("Nothing to print.");
            return;
        }
        jobs.execute(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host.trim(), port), 4000);
                socket.setSoTimeout(10000);
                OutputStream out = socket.getOutputStream();
                out.write(Base64.decode(value, Base64.DEFAULT));
                out.flush();
                call.resolve();
            } catch (IOException e) {
                call.reject("Could not reach the printer at " + host + ". Check that it is on and on this Wi-Fi.");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        jobs.shutdownNow();
    }
}

package com.kaykays.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web app whether push notifications can work in this build.
 *
 * Push needs Firebase, which is configured by google-services.json at build time.
 * Without it, PushNotifications.register() throws "Default FirebaseApp is not
 * initialized" on the native side, which JavaScript can't catch, and the whole app
 * closes. The google-services Gradle plugin writes a google_app_id string resource
 * when the file is present, so its presence is the test.
 */
@CapacitorPlugin(name = "PushSupport")
public class PushSupportPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int id = getContext().getResources()
                .getIdentifier("google_app_id", "string", getContext().getPackageName());
        boolean available = id != 0 && !getContext().getString(id).isEmpty();
        JSObject result = new JSObject();
        result.put("available", available);
        call.resolve(result);
    }
}

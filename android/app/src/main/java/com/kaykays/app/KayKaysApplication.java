package com.kaykays.app;

import android.app.Application;

/** Runs before anything else in the app process, including a push or alarm with the app closed. */
public class KayKaysApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannels.ensure(this);
    }
}

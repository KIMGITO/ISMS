package com.kaykays.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.Animation;
import android.view.animation.ScaleAnimation;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * The alarm screen. Android opens it over the lock screen (a full-screen intent) when a
 * reminder or urgent alert rings, or when the ringing notification is tapped.
 *
 * Accept is the only button: it stops the sound straight away, records the accept (sent to the
 * server by the app), then unlocks and opens the app on the alert's screen. There is no snooze,
 * by the app owner's rule. Back leaves it ringing in the background.
 */
public class AlarmActivity extends Activity implements RingService.Listener {

    private static final String TAG = "ALARM_DISMISS";
    private RingService.Alert shown;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_alarm);

        ScaleAnimation pulse = new ScaleAnimation(1f, 1.06f, 1f, 1.06f,
            Animation.RELATIVE_TO_SELF, 0.5f, Animation.RELATIVE_TO_SELF, 0.5f);
        pulse.setDuration(900);
        pulse.setRepeatMode(Animation.REVERSE);
        pulse.setRepeatCount(Animation.INFINITE);
        ((ImageView) findViewById(R.id.alarm_art)).startAnimation(pulse);

        findViewById(R.id.alarm_accept).setOnClickListener(v -> accept());
    }

    @Override
    protected void onResume() {
        super.onResume();
        RingService.setListener(this);
        onAlertsChanged();
    }

    @Override
    protected void onPause() {
        RingService.setListener(null);
        super.onPause();
    }

    @Override
    public void onAlertsChanged() {
        RingService.Alert alert = RingService.latest();
        if (alert == null) {
            finish();
            return;
        }
        shown = alert;
        TextView kind = findViewById(R.id.alarm_kind);
        TextView title = findViewById(R.id.alarm_title);
        TextView notes = findViewById(R.id.alarm_notes);
        TextView setFor = findViewById(R.id.alarm_set_for);
        TextView more = findViewById(R.id.alarm_more);
        TextView hint = findViewById(R.id.alarm_hint);

        kind.setText(alert.test ? "TEST ALARM" : alert.isReminder() ? "REMINDER" : "NEEDS YOU NOW");
        title.setText(alert.title.isEmpty() ? (alert.isReminder() ? "Reminder" : "Alert") : alert.title);
        notes.setText(alert.body);
        notes.setVisibility(alert.body.isEmpty() ? View.GONE : View.VISIBLE);
        if (alert.scheduledAt > 0) {
            setFor.setText("Set for " + AlarmScheduler.clock(alert.scheduledAt));
            setFor.setVisibility(View.VISIBLE);
        } else {
            setFor.setVisibility(View.GONE);
        }
        int others = RingService.count() - 1;
        more.setVisibility(others > 0 ? View.VISIBLE : View.GONE);
        more.setText("+" + others + " more waiting");
        hint.setText(alert.test ? "Stops the test alarm" : "Stops the alarm and opens Denso");
    }

    private void accept() {
        RingService.Alert alert = shown;
        if (alert == null) {
            finish();
            return;
        }
        boolean accepted = RingService.accept(this, alert.key);
        Log.i(TAG, "accept tapped on the alarm screen (" + (accepted ? "accepted" : "already handled") + ")");
        if (RingService.count() > 0) {
            onAlertsChanged(); // the next one that is still ringing
            return;
        }
        if (alert.test) {
            finish();
            return;
        }
        // Open the app on the alert's screen. If the phone is locked, ask to unlock first; the
        // accept is already saved either way, and the app sends it when it next opens.
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    openApp(alert);
                }

                @Override
                public void onDismissCancelled() {
                    finish();
                }

                @Override
                public void onDismissError() {
                    finish();
                }
            });
        } else {
            openApp(alert);
        }
    }

    private void openApp(RingService.Alert alert) {
        startActivity(new Intent(this, MainActivity.class)
            .setAction(RingService.ACTION_ACCEPT)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(RingService.EXTRA_ID, alert.key)
            .putExtra(RingService.EXTRA_TARGET, alert.target)
            .putExtra(RingService.EXTRA_BUSINESS, alert.businessId));
        finish();
    }

    @Override
    public void onBackPressed() {
        // The alarm keeps ringing until Accept; Back only hides this screen.
        moveTaskToBack(true);
    }
}

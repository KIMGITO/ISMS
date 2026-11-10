package com.kaykays.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What this phone keeps about reminder alarms, so they ring with the app closed, after a reboot
 * and without internet:
 *  - the alarms themselves (a copy of each reminder set for the signed-in person),
 *  - a ledger of occurrences ("schedule id|yyyy-MM-dd|HH:mm") that already rang or were accepted, so
 *    no occurrence rings twice, whether the phone's alarm or the server's push gets there first,
 *  - Accept taps the app hasn't sent to the server yet.
 *
 * Everything is in one SharedPreferences file and every method is synchronized on the class,
 * because the receiver, the push service and the plugin can run at the same time.
 */
final class AlarmStore {

    private static final String PREFS = "kaykays_alarms";
    private static final String KEY_ALARMS = "alarms";
    private static final String KEY_LEDGER = "ledger";
    private static final String KEY_OWNER = "owner";
    private static final String KEY_ACCEPTS = "pending_accepts";
    private static final String KEY_TOKEN = "fcm_token";
    private static final long LEDGER_KEEP_MS = 4L * 24 * 60 * 60 * 1000;

    static final String STATE_RINGING = "ringing";
    static final String STATE_ACCEPTED = "accepted";

    private AlarmStore() {}

    /** One reminder, as the server describes it. Times are Nairobi wall-clock time. */
    static final class Alarm {
        String id = "";
        String businessId = "";
        String userId = "";
        String title = "";
        String notes = "";
        String date = "";            // yyyy-MM-dd, the first day it rings
        String time = "";            // HH:mm
        String repeat = "None";      // None | Daily | Weekly | Monthly
        String lastRemindedOn = "";  // yyyy-MM-dd the server already rang, or ""
        String updatedAt = "";
        boolean test = false;        // a test alarm from Settings: never sent to the server

        static Alarm fromJson(JSONObject o) {
            Alarm a = new Alarm();
            a.id = o.optString("id", "");
            a.businessId = o.optString("business_id", o.optString("businessId", ""));
            a.userId = o.optString("user_id", o.optString("userId", ""));
            a.title = o.optString("title", "");
            a.notes = o.optString("notes", "");
            if ("null".equals(a.notes)) a.notes = "";
            a.date = o.optString("date", "");
            String t = o.optString("start_time", o.optString("time", ""));
            a.time = t.length() >= 5 ? t.substring(0, 5) : t;
            a.repeat = o.optString("repeat", "None");
            a.lastRemindedOn = o.optString("last_reminded_on", o.optString("lastRemindedOn", ""));
            if ("null".equals(a.lastRemindedOn)) a.lastRemindedOn = "";
            a.updatedAt = o.optString("updated_at", o.optString("updatedAt", ""));
            a.test = o.optBoolean("test", false);
            return a;
        }

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("id", id).put("business_id", businessId).put("user_id", userId)
                    .put("title", title).put("notes", notes).put("date", date).put("time", time)
                    .put("repeat", repeat).put("last_reminded_on", lastRemindedOn)
                    .put("updated_at", updatedAt).put("test", test);
            } catch (JSONException ignored) {
            }
            return o;
        }

        boolean isValid() {
            return !id.isEmpty() && date.matches("\\d{4}-\\d{2}-\\d{2}") && time.matches("\\d{2}:\\d{2}");
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject readObject(Context c, String key) {
        try {
            return new JSONObject(prefs(c).getString(key, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    // ---- alarms -------------------------------------------------------------------------

    static synchronized List<Alarm> all(Context c) {
        JSONObject map = readObject(c, KEY_ALARMS);
        List<Alarm> out = new ArrayList<>();
        Iterator<String> keys = map.keys();
        while (keys.hasNext()) {
            JSONObject o = map.optJSONObject(keys.next());
            if (o != null) out.add(Alarm.fromJson(o));
        }
        return out;
    }

    static synchronized Alarm get(Context c, String id) {
        JSONObject o = readObject(c, KEY_ALARMS).optJSONObject(id);
        return o == null ? null : Alarm.fromJson(o);
    }

    static synchronized void put(Context c, Alarm a) {
        JSONObject map = readObject(c, KEY_ALARMS);
        try {
            map.put(a.id, a.toJson());
        } catch (JSONException ignored) {
        }
        prefs(c).edit().putString(KEY_ALARMS, map.toString()).apply();
    }

    static synchronized void remove(Context c, String id) {
        JSONObject map = readObject(c, KEY_ALARMS);
        map.remove(id);
        prefs(c).edit().putString(KEY_ALARMS, map.toString()).apply();
    }

    static synchronized void replaceAll(Context c, List<Alarm> alarms) {
        JSONObject map = new JSONObject();
        for (Alarm a : alarms) {
            try {
                map.put(a.id, a.toJson());
            } catch (JSONException ignored) {
            }
        }
        prefs(c).edit().putString(KEY_ALARMS, map.toString()).apply();
    }

    // ---- owner: the person whose alarms these are -----------------------------------------

    static synchronized String owner(Context c) {
        return prefs(c).getString(KEY_OWNER, "");
    }

    static synchronized void setOwner(Context c, String userId) {
        prefs(c).edit().putString(KEY_OWNER, userId == null ? "" : userId).apply();
    }

    // ---- ledger -------------------------------------------------------------------------

    /**
     * One ring of a reminder: its day AND its time. Moving a reminder to a later time the same
     * day is a new ring, so an accept at the old time must not silence the new one.
     */
    static String occurrenceKey(String scheduleId, String date, String time) {
        return scheduleId + "|" + date + "|" + (time == null ? "" : time);
    }

    static synchronized String state(Context c, String scheduleId, String date, String time) {
        JSONObject e = readObject(c, KEY_LEDGER).optJSONObject(occurrenceKey(scheduleId, date, time));
        return e == null ? null : e.optString("s", null);
    }

    /** Records an occurrence's state. "accepted" is final; "ringing" never overwrites it. */
    static synchronized void mark(Context c, String scheduleId, String date, String time, String state) {
        JSONObject ledger = readObject(c, KEY_LEDGER);
        String key = occurrenceKey(scheduleId, date, time);
        JSONObject existing = ledger.optJSONObject(key);
        if (existing != null && STATE_ACCEPTED.equals(existing.optString("s")) && !STATE_ACCEPTED.equals(state)) return;
        long now = System.currentTimeMillis();
        try {
            ledger.put(key, new JSONObject().put("s", state).put("t", now));
        } catch (JSONException ignored) {
        }
        // Forget old entries; alarms never look back more than a day.
        Iterator<String> keys = ledger.keys();
        List<String> old = new ArrayList<>();
        while (keys.hasNext()) {
            String k = keys.next();
            JSONObject v = ledger.optJSONObject(k);
            if (v == null || now - v.optLong("t", 0) > LEDGER_KEEP_MS) old.add(k);
        }
        for (String k : old) ledger.remove(k);
        prefs(c).edit().putString(KEY_LEDGER, ledger.toString()).apply();
    }

    // ---- Accept taps waiting for the app ---------------------------------------------------

    static synchronized void queueAccept(Context c, JSONObject accept) {
        JSONArray list;
        try {
            list = new JSONArray(prefs(c).getString(KEY_ACCEPTS, "[]"));
        } catch (JSONException e) {
            list = new JSONArray();
        }
        list.put(accept);
        // Bounded, in case the app is never opened again.
        while (list.length() > 50) list.remove(0);
        prefs(c).edit().putString(KEY_ACCEPTS, list.toString()).apply();
    }

    static synchronized JSONArray takeAccepts(Context c) {
        JSONArray list;
        try {
            list = new JSONArray(prefs(c).getString(KEY_ACCEPTS, "[]"));
        } catch (JSONException e) {
            list = new JSONArray();
        }
        prefs(c).edit().putString(KEY_ACCEPTS, "[]").apply();
        return list;
    }

    // ---- diagnostics ----------------------------------------------------------------------

    static synchronized void setToken(Context c, String token) {
        prefs(c).edit().putString(KEY_TOKEN, token == null ? "" : token).apply();
    }

    static synchronized boolean hasToken(Context c) {
        return !prefs(c).getString(KEY_TOKEN, "").isEmpty();
    }

    /** Sign-out: nothing of the last person's may ring for the next one. */
    static synchronized void clear(Context c) {
        prefs(c).edit().remove(KEY_ALARMS).remove(KEY_OWNER).remove(KEY_ACCEPTS).remove(KEY_LEDGER).apply();
    }
}

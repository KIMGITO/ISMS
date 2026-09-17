-- =============================================================================
-- 20260820_device_tone_sounds.sql
-- integrated Shop Management System
-- Per-device notification tone sound
-- =============================================================================
-- Why: Each user device (web/mobile) can select its own notification tone.
-- The selected tone is stored here per device token, then read by the send-fcm
-- edge function so the FCM payload carries the correct `sound` field.
-- Dependencies: 003 (device_fcm_tokens table)
-- =============================================================================

BEGIN;

ALTER TABLE public.device_fcm_tokens
    ADD COLUMN IF NOT EXISTS sound TEXT NOT NULL DEFAULT 'beep';

-- Keep the RLS behavior intact: the column is selectable/updatable by the
-- same policies that already govern device_fcm_tokens (own tokens only).

COMMIT;
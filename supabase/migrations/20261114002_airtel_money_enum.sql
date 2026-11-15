-- =============================================================================
-- 20261114002_airtel_money_enum.sql
-- Airtel Money becomes the fifth way money comes in. Sales store their method in the
-- payment_method enum, so the value is added here on its own: Postgres won't let a new enum
-- value be used in the same transaction that adds it, and 20261114003 uses it.
-- =============================================================================

ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'Airtel Money';

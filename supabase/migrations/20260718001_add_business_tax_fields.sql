-- Migration: Add Tax Settings to public.businesses Table
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS is_tax_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS tax_percentage NUMERIC NOT NULL DEFAULT 16.0;

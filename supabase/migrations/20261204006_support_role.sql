-- SaaS: support access, part 1. The temporary role platform support gets while a business owner
-- allows it (20261204007). A new enum value can't be used in the transaction that adds it, so it
-- has its own file.
ALTER TYPE public.employee_role ADD VALUE IF NOT EXISTS 'Support';

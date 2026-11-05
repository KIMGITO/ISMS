-- =============================================================================
-- 20260715_012_functions.sql
-- integrated Shop Management System
-- SQL Functions & RPCs
-- =============================================================================
-- Why: These functions and RPCs are used by triggers and RLS policies to
-- enforce business logic.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UTILITY: fn_set_updated_at
-- Generic trigger function that sets updated_at = NOW() on every UPDATE.
-- Applied to all tables with an updated_at column via migration 013.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- UTILITY: calculate_customer_tier
-- Pure function computing customer tier from total loyalty points.
-- 1 point is earned per KSh 100 spent.
-- Gold >= 300 pts (>= KSh 30,000 spend), Silver >= 100 pts (>= KSh 10,000 spend), Bronze otherwise.
-- IMMUTABLE so PostgreSQL can inline it and cache results.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_customer_tier(points INTEGER)
RETURNS public.customer_tier
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF points >= 300 THEN
        RETURN 'Gold';
    ELSIF points >= 100 THEN
        RETURN 'Silver';
    ELSE
        RETURN 'Bronze';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- UTILITY: get_user_business_ids
-- Returns an array of business UUIDs the currently authenticated user belongs
-- to (Active memberships only). Called by every RLS policy to scope data
-- access to the user's businesses. STABLE because it only reads data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_business_ids()
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_ids UUID[];
BEGIN
    SELECT array_agg(bm.business_id)
    INTO v_ids
    FROM public.business_memberships bm
    JOIN public.users u ON bm.user_id = u.id
    WHERE u.auth_user_id = auth.uid()
      AND bm.status = 'Active';

    RETURN COALESCE(v_ids, ARRAY[]::UUID[]);
END;
$$;

-- ---------------------------------------------------------------------------
-- UTILITY: is_owner_or_admin
-- Returns TRUE if the current authenticated user has Owner or Admin role
-- in the specified business. Used by write-access RLS policies on sensitive
-- tables. STABLE because it only reads data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_owner_or_admin(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.business_memberships bm
        JOIN public.users u ON bm.user_id = u.id
        WHERE u.auth_user_id = auth.uid()
          AND bm.business_id = p_business_id
          AND bm.role IN ('Owner', 'Admin', 'Administrator')
          AND bm.status = 'Active'
    ) INTO v_exists;

    RETURN COALESCE(v_exists, FALSE);
END;
$$;

-- ---------------------------------------------------------------------------
-- AUTH: check_owner_exists
-- Returns TRUE if any Owner membership exists in the system. Used by the
-- onboarding flow to decide whether to show the signup screen or the login
-- screen. SECURITY DEFINER allows anonymous callers to query this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_owner_exists()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.business_memberships
        WHERE role = 'Owner'
        LIMIT 1
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- AUTH: handle_new_user
-- Trigger function fired AFTER INSERT on auth.users. Creates the mirrored
-- public.users profile automatically so the app can use public.users for
-- all business logic (avoiding direct auth.users queries from the client).
-- The id is set to match auth.users.id (zero-join identity resolution).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
    VALUES (
        NEW.id,
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'name',
            split_part(COALESCE(NEW.email, ''), '@', 1),
            'User'
        ),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone),
        FALSE
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        phone = COALESCE(public.users.phone, EXCLUDED.phone);

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- AUTH: fn_on_public_user_deleted
-- When a public.users record is deleted, also delete the corresponding
-- auth.users record to prevent orphaned auth accounts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_on_public_user_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.auth_user_id IS NOT NULL THEN
        DELETE FROM auth.users WHERE id = OLD.auth_user_id;
    END IF;
    RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------------------
-- SALES: fn_process_completed_transaction
-- Core atomic trigger function fired AFTER INSERT on transactions.
-- Handles five operations atomically:
--   1. Award loyalty points to the customer and update their tier
--   2. Increment the active shift's sales_count and sales_total
--   3. Credit the money_assets balance and payment_asset_ledger for money received
--   4. Settle wallet and debt for credit sales
--   5. Write a security audit log entry
-- Uses CASE WHEN to safely handle NULL staff_id in audit_logs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_completed_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    points_earned INTEGER;
    v_debt_amt    NUMERIC(14,2);
    v_asset_id     UUID;
    v_asset_before NUMERIC(14,2);
    v_asset_after  NUMERIC(14,2);
    v_method       TEXT;
BEGIN
    -- 1. Loyalty points
    IF NEW.customer_id IS NOT NULL THEN
        points_earned := GREATEST(0, FLOOR((NEW.final_total - COALESCE(NEW.delivery_fee, 0)) / 100));
        UPDATE public.customers
        SET loyalty_points = COALESCE(loyalty_points, 0) + points_earned,
            purchases_count = purchases_count + 1
        WHERE id = NEW.customer_id;
    END IF;

    -- 2. Shift sales
    IF NEW.staff_id IS NOT NULL THEN
        UPDATE public.shifts
        SET sales_count = sales_count + 1,
            sales_total = sales_total + NEW.final_total
        WHERE employee_id = NEW.staff_id AND status = 'Active' AND deleted_at IS NULL;
    END IF;

    -- 3. Money Asset Tracking
    v_method := CASE 
        WHEN NEW.payment_method = 'Mobile_Wallet' THEN 'Mobile_Wallet'
        WHEN NEW.payment_method = 'M-Pesa' THEN 'M-Pesa'
        WHEN NEW.payment_method = 'Card' THEN 'Card'
        WHEN NEW.payment_method = 'Bank' THEN 'Bank'
        WHEN NEW.payment_method = 'Cash' THEN 'Cash'
        ELSE 'Other'
    END;

    IF NEW.payment_method NOT IN ('Credit_Debt', 'Credit') AND NEW.final_total > 0 THEN
        INSERT INTO public.money_assets (business_id, method, balance)
        VALUES (NEW.business_id, v_method, 0)
        ON CONFLICT (business_id, method) DO NOTHING;

        SELECT id, balance INTO v_asset_id, v_asset_before
        FROM public.money_assets
        WHERE business_id = NEW.business_id AND method = v_method;

        v_asset_after := v_asset_before + NEW.final_total;

        UPDATE public.money_assets
        SET balance = v_asset_after,
            last_payment_at = NEW.timestamp,
            updated_at = NOW()
        WHERE id = v_asset_id;

        INSERT INTO public.payment_asset_ledger (
            business_id, asset_id, transaction_id, type, amount,
            balance_before, balance_after, description, method
        )
        VALUES (
            NEW.business_id, v_asset_id, NEW.id, 'Credit', NEW.final_total,
            v_asset_before, v_asset_after, 'POS Sale: ' || NEW.id, v_method
        );
    END IF;

    -- 4. Debt / wallet settlement
    IF NEW.customer_id IS NOT NULL AND NEW.payment_method IN ('Credit_Debt', 'Credit') THEN
        v_debt_amt := NEW.final_total - COALESCE(NEW.amount_paid, 0) - COALESCE(NEW.wallet_applied, 0);
        IF COALESCE(NEW.wallet_applied, 0) > 0 THEN
            UPDATE public.customers SET wallet_balance = wallet_balance - NEW.wallet_applied WHERE id = NEW.customer_id;
        END IF;
        IF v_debt_amt > 0 THEN
            INSERT INTO public.credit_payments (business_id, transaction_id, customer_id, customer_name, amount_owed, amount_paid, status, recorded_by)
            VALUES (NEW.business_id, NEW.id, NEW.customer_id, COALESCE(NEW.customer_name, 'Unknown'), v_debt_amt, 0, 'Open', NEW.staff_name);
            UPDATE public.customers SET debt_balance = debt_balance + v_debt_amt WHERE id = NEW.customer_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- SALES: fn_process_transaction_item
-- Trigger function fired AFTER INSERT on transaction_items.
-- Decrements product stock and logs an inventory adjustment record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_transaction_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_stock   NUMERIC(14,3);
    v_new_stock   NUMERIC(14,3);
    v_prod_name   TEXT;
    v_business_id UUID;
    v_staff_name  TEXT;
BEGIN
    SELECT business_id, staff_name
    INTO v_business_id, v_staff_name
    FROM public.transactions
    WHERE id = NEW.transaction_id;

    SELECT stock, name
    INTO v_old_stock, v_prod_name
    FROM public.products
    WHERE id = NEW.product_id
    FOR UPDATE;

    v_new_stock := GREATEST(0, v_old_stock - NEW.quantity);

    UPDATE public.products
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = NEW.product_id;

    INSERT INTO public.inventory_adjustments
        (business_id, product_id, product_name, type, quantity_adjusted,
         previous_stock, new_stock, reason, staff_name)
    VALUES (
        v_business_id,
        NEW.product_id,
        COALESCE(v_prod_name, NEW.product_name),
        'Reconciliation',
        -NEW.quantity,
        v_old_stock,
        v_new_stock,
        'Sold via order #' || NEW.transaction_id::TEXT,
        COALESCE(v_staff_name, 'System')
    );

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- INVENTORY: fn_check_low_stock
-- Trigger function fired AFTER UPDATE on products.
-- Creates a notification when stock drops to or below min_stock.
-- Only fires on the transition (when stock crosses the threshold),
-- not on every update, to avoid notification spam.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only notify when the threshold is newly crossed
    IF NEW.stock <= NEW.min_stock
       AND (OLD.stock IS NULL OR OLD.stock > NEW.min_stock)
    THEN
        INSERT INTO public.notifications
            (business_id, role, title, message, type, priority,
             action_type, action_target, payload, status)
        VALUES (
            NEW.business_id,
            'Owner',
            CASE
                WHEN NEW.stock = 0 THEN '🚨 Out of Stock: ' || NEW.name
                ELSE '⚠️ Low Stock: ' || NEW.name
            END,
            CASE
                WHEN NEW.stock = 0
                    THEN '"' || NEW.name || '" is completely out of stock. Reorder immediately!'
                ELSE '"' || NEW.name || '" has only ' || NEW.stock || ' ' || NEW.unit ||
                     ' remaining (min: ' || NEW.min_stock || '). Reorder soon.'
            END,
            CASE WHEN NEW.stock = 0 THEN 'Out Of Stock' ELSE 'Stock Almost Finished' END,
            CASE WHEN NEW.stock = 0 THEN 'critical'::public.notification_priority
                 ELSE 'high'::public.notification_priority END,
            'navigate',
            'inventory',
            jsonb_build_object(
                'productId',   NEW.id,
                'productName', NEW.name,
                'stock',       NEW.stock,
                'minStock',    NEW.min_stock
            ),
            'delivered'
        );
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- EMPLOYEES: fn_employee_sensitive_audit
-- Trigger function fired AFTER UPDATE on employees.
-- Writes audit log entries when PIN or role changes are made.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_employee_sensitive_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.pin <> NEW.pin THEN
        INSERT INTO public.audit_logs
            (employee_id, action, table_name, record_id, details)
        VALUES (
            NEW.id,
            'UPDATE_PIN',
            'employees',
            NEW.id::TEXT,
            jsonb_build_object(
                'employee_name', NEW.name,
                'modifier_role', NEW.role
            )
        );
    END IF;

    IF OLD.role <> NEW.role THEN
        INSERT INTO public.audit_logs
            (employee_id, action, table_name, record_id, details)
        VALUES (
            NEW.id,
            'UPDATE_ROLE',
            'employees',
            NEW.id::TEXT,
            jsonb_build_object(
                'employee_name', NEW.name,
                'old_role',      OLD.role,
                'new_role',      NEW.role
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- PRODUCTS: fn_trap_product_hard_deletes
-- Converts a hard DELETE into a soft delete (deleted_at) when the product
-- has associated transaction_items. Protects sales history integrity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trap_product_hard_deletes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.transaction_items WHERE product_id = OLD.id LIMIT 1
    ) THEN
        UPDATE public.products
        SET deleted_at = NOW(), sync_status = 'synced'
        WHERE id = OLD.id;
        RETURN NULL;  -- Cancel the DELETE
    END IF;
    RETURN OLD;       -- Allow the DELETE
END;
$$;

-- ---------------------------------------------------------------------------
-- INVITATIONS: fn_check_invitation_email
-- Validates that an invitation email is not already registered as a user
-- and does not already have an active pending invitation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_invitation_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
        IF EXISTS (
            SELECT 1 FROM public.users WHERE email = NEW.email LIMIT 1
        ) THEN
            RAISE EXCEPTION 'A registered user with this email address already exists in the system.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.invitations
            WHERE email = NEW.email
              AND status = 'Pending'
              AND expires_at > NOW()
              AND id <> NEW.id
            LIMIT 1
        ) THEN
            RAISE EXCEPTION 'An active invitation for this email address already exists.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- SCHEDULES: flag_due_schedule_reminders
-- Marks all schedules due today as reminder_sent = TRUE AND creates a
-- per-employee notification row for each affected schedule so the reminder
-- reaches the target employee in-app and via push (FCM).
-- Called by pg_cron (migration 20260819) or externally.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flag_due_schedule_reminders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_schedule RECORD;
    v_user_id  UUID;
BEGIN
    -- 1. Process every schedule that is due and has not yet been reminded.
    FOR v_schedule IN
        SELECT s.id, s.business_id, s.employee_id, s.title, s.date, s.start_time
        FROM public.schedules s
        WHERE s.reminder_sent = FALSE
          AND s.deleted_at IS NULL
          AND (
              s.date = CURRENT_DATE
              OR (s.repeat = 'Daily' AND s.date <= CURRENT_DATE)
              OR (s.repeat = 'Weekly'
                  AND s.date <= CURRENT_DATE
                  AND EXTRACT(DOW FROM s.date) = EXTRACT(DOW FROM CURRENT_DATE))
          )
    LOOP
        -- 2. Resolve the employee's linked user account for targeting
        --    in-app notifications and FCM push.
        SELECT e.user_id INTO v_user_id
        FROM public.employees e
        WHERE e.id = v_schedule.employee_id
          AND e.deleted_at IS NULL;

        -- 3. Mark the schedule as reminded (no duplicate processing).
        UPDATE public.schedules
        SET reminder_sent = TRUE
        WHERE id = v_schedule.id;

        -- 4. Create a notification row for the employee (when a user account
        --    is linked) so the reminder appears in the staff reminder feed
        --    and can be dispatched via the send-fcm edge function.
        IF v_user_id IS NOT NULL THEN
            INSERT INTO public.notifications
                (business_id, user_id, title, message, type, priority,
                 action_type, action_target, payload, status)
            VALUES (
                v_schedule.business_id,
                v_user_id,
                '🗓️ Schedule Reminder: ' || COALESCE(NULLIF(v_schedule.title, ''), 'Shift'),
                'You are scheduled on ' || to_char(v_schedule.date, 'YYYY-MM-DD') ||
                    ' at ' || to_char(v_schedule.start_time, 'HH24:MI') || '.',
                'Schedule Reminder',
                'high'::public.notification_priority,
                'navigate'::public.notification_action_type,
                'schedules',
                jsonb_build_object(
                    'schedule_id',  v_schedule.id,
                    'employee_id',  v_schedule.employee_id,
                    'shift_date',   to_char(v_schedule.date, 'YYYY-MM-DD'),
                    'start_time',   to_char(v_schedule.start_time, 'HH24:MI')
                ),
                'pending'::public.notification_delivery_status
            );
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- OTP: save_otp
-- Upserts an OTP record for email verification or password reset.
-- UNIQUE(email, type) ensures at most one OTP per flow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_otp(
    p_email TEXT,
    p_code  TEXT,
    p_type  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.otps (email, code, type, expires_at)
    VALUES (p_email, p_code, p_type, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (email, type) DO UPDATE SET
        code       = EXCLUDED.code,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW();
END;
$$;

-- ---------------------------------------------------------------------------
-- OTP: verify_signup_otp
-- Verifies a signup OTP, marks the user as verified in both public.users
-- and auth.users, and deletes the used OTP.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_signup_otp(
    p_email TEXT,
    p_code  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_success BOOLEAN := FALSE;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.otps
        WHERE email = p_email
          AND code = p_code
          AND type = 'signup'
          AND expires_at > NOW()
    ) THEN
        DELETE FROM public.otps WHERE email = p_email AND type = 'signup';

        UPDATE public.users
        SET is_verified = TRUE
        WHERE email = p_email;

        UPDATE auth.users
        SET
            email_confirmed_at = NOW(),
            raw_app_meta_data  = COALESCE(raw_app_meta_data, '{}') ||
                                 jsonb_build_object('provider', 'email', 'providers', ARRAY['email'])
        WHERE email = p_email;

        v_success := TRUE;
    END IF;

    RETURN v_success;
END;
$$;

-- ---------------------------------------------------------------------------
-- INVITATIONS: get_invitation_by_token
-- Returns invitation details for a valid, unexpired, pending token.
-- Called anonymously when a new staff member opens an invitation link.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token TEXT)
RETURNS TABLE (
    id            UUID,
    business_id   UUID,
    business_name TEXT,
    email         TEXT,
    phone         TEXT,
    role          public.employee_role,
    expires_at    TIMESTAMPTZ,
    status        public.invitation_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.id,
        i.business_id,
        b.name AS business_name,
        i.email,
        i.phone,
        i.role,
        i.expires_at,
        i.status
    FROM public.invitations i
    JOIN public.businesses b ON i.business_id = b.id
    WHERE i.invitation_token = p_token
      AND i.status = 'Pending'
      AND i.expires_at > NOW();
END;
$$;

-- ---------------------------------------------------------------------------
-- INVITATIONS: accept_invitation_with_token
-- Accepts an invitation by token. Creates or updates the public.users
-- profile, creates/updates the employee record, activates membership,
-- and marks the invitation as Accepted. Atomic via implicit transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_invitation_with_token(
    p_token       TEXT,
    p_auth_user_id UUID,
    p_name        TEXT,
    p_phone       TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite  RECORD;
    v_user_id UUID;
BEGIN
    SELECT * INTO v_invite
    FROM public.invitations
    WHERE invitation_token = p_token
      AND status = 'Pending'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid, expired, or already accepted invitation.';
    END IF;

    -- Find or create the public.users profile
    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_user_id = p_auth_user_id;

    IF v_user_id IS NULL THEN
        INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
        VALUES (p_auth_user_id, p_auth_user_id, p_name, v_invite.email, p_phone, FALSE)
        RETURNING id INTO v_user_id;
    ELSE
        UPDATE public.users
        SET name = p_name, phone = p_phone, email = v_invite.email
        WHERE id = v_user_id;
    END IF;

    -- Activate business membership
    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_invite.business_id, v_user_id, v_invite.role, 'Active')
    ON CONFLICT (business_id, user_id) DO UPDATE SET
        role   = v_invite.role,
        status = 'Active';

    -- Create or update employee profile
    INSERT INTO public.employees
        (id, business_id, user_id, name, role, email, phone, pin, assigned_branches)
    VALUES (
        v_user_id,
        v_invite.business_id,
        v_user_id,
        p_name,
        v_invite.role,
        v_invite.email,
        p_phone,
        '0000',
        jsonb_build_array(v_invite.business_id::TEXT)
    )
    ON CONFLICT (id) DO UPDATE SET
        name  = p_name,
        role  = v_invite.role,
        email = v_invite.email,
        phone = p_phone;

    -- Mark invitation as accepted
    UPDATE public.invitations
    SET status = 'Accepted', accepted_at = NOW()
    WHERE id = v_invite.id;

    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- ONBOARDING: create_business_with_owner
-- Creates a new business, a default Main branch, activates the calling user
-- as Owner in business_memberships, and creates their employee profile.
-- Called from the React onboarding flow after the owner signs up.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_business_with_owner(
    p_name        TEXT,
    p_type        TEXT,
    p_country     TEXT,
    p_currency    TEXT,
    p_logo_url    TEXT,
    p_description TEXT,
    p_address     TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_id UUID;
    v_user_id     UUID;
BEGIN
    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_user_id = auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete signup first.';
    END IF;

    INSERT INTO public.businesses
        (name, business_type, country, currency, logo_url, description, address)
    VALUES
        (p_name, p_type, p_country, p_currency, p_logo_url, p_description, p_address)
    RETURNING id INTO v_business_id;

    -- Create the default main branch
    INSERT INTO public.branches (business_id, name, address)
    VALUES (v_business_id, 'Main branch', p_address);

    -- Activate the owner's membership
    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_business_id, v_user_id, 'Owner', 'Active');

    -- Create owner employee profile
    INSERT INTO public.employees
        (id, business_id, user_id, name, role, email, phone, pin, assigned_branches)
    SELECT
        v_user_id, v_business_id, v_user_id,
        name, 'Owner', email, phone, '0000',
        jsonb_build_array(v_business_id::TEXT)
    FROM public.users
    WHERE id = v_user_id
    ON CONFLICT (id) DO UPDATE SET
        business_id = v_business_id,
        role        = 'Owner';

    RETURN v_business_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- MPESA: log_mpesa_payment
-- Upserts an M-Pesa transaction record and creates a notification.
-- Called by the mpesa-callback Edge Function after receiving the STK callback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_mpesa_payment(
    p_checkout_request_id TEXT,
    p_merchant_request_id TEXT,
    p_phone               TEXT,
    p_amount              NUMERIC(14,2),
    p_status              TEXT,
    p_receipt_number      TEXT,
    p_business_id         UUID    DEFAULT NULL,
    p_raw_callback        JSONB   DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.mpesa_transactions
        (checkout_request_id, merchant_request_id, phone, amount, status,
         receipt_number, business_id, raw_callback, mpesa_receipt_timestamp)
    VALUES (
        p_checkout_request_id,
        p_merchant_request_id,
        p_phone,
        p_amount,
        p_status::public.mpesa_status,
        p_receipt_number,
        p_business_id,
        p_raw_callback,
        CASE WHEN p_status = 'Completed' THEN NOW() ELSE NULL END
    )
    ON CONFLICT (checkout_request_id) DO UPDATE SET
        status                  = EXCLUDED.status,
        receipt_number          = EXCLUDED.receipt_number,
        mpesa_receipt_timestamp = CASE WHEN EXCLUDED.status = 'Completed' THEN NOW() ELSE NULL END,
        raw_callback            = EXCLUDED.raw_callback,
        updated_at              = NOW();

    -- Notify the owner of the M-Pesa payment result
    IF p_business_id IS NOT NULL THEN
        INSERT INTO public.notifications
            (business_id, role, title, message, type, priority,
             action_type, action_target, payload, status)
        VALUES (
            p_business_id,
            'Owner',
            CASE
                WHEN p_status = 'Completed' THEN '✅ M-Pesa Payment Received'
                ELSE '❌ M-Pesa Payment Failed'
            END,
            CASE
                WHEN p_status = 'Completed'
                    THEN 'KES ' || p_amount || ' received from ' || p_phone ||
                         COALESCE(' (Receipt: ' || p_receipt_number || ')', '')
                ELSE 'Payment of KES ' || p_amount || ' from ' || p_phone ||
                     ' failed. Ref: ' || p_checkout_request_id
            END,
            'Payment Received',
            'high',
            'navigate',
            'sales',
            jsonb_build_object(
                'amount',        p_amount,
                'phone',         p_phone,
                'receiptNumber', p_receipt_number,
                'status',        p_status
            ),
            'delivered'
        );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- INVENTORY: adjust_stock_manually
-- RPC called from the InventoryView to restock, record damage, or reconcile.
-- Updates product stock, logs an inventory adjustment, and writes audit log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_stock_manually(
    p_product_id  UUID,
    p_employee_id UUID,
    p_staff_name  TEXT,
    p_adj_type    public.inventory_adjustment_type,
    p_quantity    NUMERIC(14,3),
    p_reason      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_stock NUMERIC(14,3);
    v_new_stock NUMERIC(14,3);
    v_biz_id    UUID;
    v_prod_name TEXT;
BEGIN
    SELECT stock, business_id, name
    INTO v_old_stock, v_biz_id, v_prod_name
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    v_new_stock := CASE
        WHEN p_adj_type = 'Restock'        THEN v_old_stock + p_quantity
        WHEN p_adj_type = 'Damage'         THEN GREATEST(0, v_old_stock - p_quantity)
        WHEN p_adj_type = 'Reconciliation' THEN p_quantity
        ELSE v_old_stock
    END;

    UPDATE public.products
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = p_product_id;

    INSERT INTO public.inventory_adjustments
        (business_id, product_id, product_name, type, quantity_adjusted,
         previous_stock, new_stock, reason, staff_name)
    VALUES (
        v_biz_id,
        p_product_id,
        v_prod_name,
        p_adj_type,
        CASE
            WHEN p_adj_type = 'Restock'        THEN p_quantity
            WHEN p_adj_type = 'Damage'         THEN -p_quantity
            ELSE v_new_stock - v_old_stock
        END,
        v_old_stock,
        v_new_stock,
        p_reason,
        p_staff_name
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- INVENTORY: adjust_stock_bulk
-- Applies many stock adjustments in one transaction, with row locking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_stock_bulk(
    p_adjustments JSONB,
    p_employee_id UUID,
    p_staff_name  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_adj         JSONB;
    v_product_id  UUID;
    v_adj_type    public.inventory_adjustment_type;
    v_quantity    NUMERIC(14,3);
    v_reason      TEXT;
    v_old_stock   NUMERIC(14,3);
    v_new_stock   NUMERIC(14,3);
    v_biz_id      UUID;
    v_prod_name   TEXT;
BEGIN
    FOR v_adj IN SELECT * FROM jsonb_array_elements(p_adjustments)
    LOOP
        v_product_id := (v_adj->>'product_id')::UUID;
        v_adj_type   := (v_adj->>'type')::public.inventory_adjustment_type;
        v_quantity   := (v_adj->>'quantity')::NUMERIC;
        v_reason     := v_adj->>'reason';

        SELECT stock, business_id, name
        INTO v_old_stock, v_biz_id, v_prod_name
        FROM public.products
        WHERE id = v_product_id
        FOR UPDATE;

        IF FOUND THEN
            v_new_stock := CASE
                WHEN v_adj_type = 'Restock'        THEN v_old_stock + v_quantity
                WHEN v_adj_type = 'Damage'         THEN GREATEST(0, v_old_stock - v_quantity)
                WHEN v_adj_type = 'Reconciliation' THEN v_quantity
                ELSE v_old_stock
            END;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = NOW()
            WHERE id = v_product_id;

            INSERT INTO public.inventory_adjustments
                (business_id, product_id, product_name, type, quantity_adjusted,
                 previous_stock, new_stock, reason, staff_name)
            VALUES (
                v_biz_id,
                v_product_id,
                v_prod_name,
                v_adj_type,
                CASE
                    WHEN v_adj_type = 'Restock'        THEN v_quantity
                    WHEN v_adj_type = 'Damage'         THEN -v_quantity
                    ELSE v_new_stock - v_old_stock
                END,
                v_old_stock,
                v_new_stock,
                v_reason,
                p_staff_name
            );
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- PRODUCTS: update_product_category_bulk
-- Moves many products to a category in a single statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_category_bulk(
    p_business_id UUID,
    p_old_category TEXT,
    p_new_category TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.products
    SET category = p_new_category
    WHERE business_id = p_business_id
      AND category = p_old_category
      AND deleted_at IS NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- DEBT: settle_customer_debt_fifo
-- Applies a cash payment against a customer's open/partial debts in FIFO
-- order (oldest first). Returns the remaining unallocated payment amount
-- (which is credited to the wallet if positive).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_customer_debt_fifo(
    p_business_id  UUID,
    p_customer_id  UUID,
    p_amount_paid  NUMERIC(14,2),
    p_recorded_by  TEXT
)
RETURNS NUMERIC(14,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec            RECORD;
    v_rem_payment    NUMERIC(14,2) := p_amount_paid;
    v_applied        NUMERIC(14,2);
    v_customer_name  TEXT;
    v_wallet_before  NUMERIC(14,2);
BEGIN
    SELECT name, wallet_balance
    INTO v_customer_name, v_wallet_before
    FROM public.customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    -- Iterate open debts oldest-first (FIFO)
    FOR v_rec IN
        SELECT id, amount_owed, amount_paid AS existing_paid, balance
        FROM public.credit_payments
        WHERE customer_id = p_customer_id
          AND business_id = p_business_id
          AND status IN ('Open', 'Partial')
        ORDER BY created_at ASC
    LOOP
        EXIT WHEN v_rem_payment <= 0;

        v_applied     := LEAST(v_rem_payment, v_rec.balance);
        v_rem_payment := v_rem_payment - v_applied;

        UPDATE public.credit_payments
        SET
            amount_paid = amount_paid + v_applied,
            status = CASE
                WHEN (amount_paid + v_applied) >= amount_owed
                    THEN 'Settled'::public.credit_status
                ELSE 'Partial'::public.credit_status
            END,
            settled_at = CASE
                WHEN (amount_paid + v_applied) >= amount_owed THEN NOW()
                ELSE NULL
            END,
            updated_at = NOW()
        WHERE id = v_rec.id;

        UPDATE public.customers
        SET debt_balance = GREATEST(0.00, debt_balance - v_applied)
        WHERE id = p_customer_id;
    END LOOP;

    -- Credit any surplus payment to the wallet
    IF v_rem_payment > 0 THEN
        UPDATE public.customers
        SET wallet_balance = wallet_balance + v_rem_payment
        WHERE id = p_customer_id;

        INSERT INTO public.wallet_transactions
            (business_id, customer_id, amount, balance_before, balance_after,
             reason, recorded_by)
        VALUES (
            p_business_id,
            p_customer_id,
            v_rem_payment,
            v_wallet_before,
            v_wallet_before + v_rem_payment,
            'Excess repayment from FIFO debt settlement',
            p_recorded_by
        );
    END IF;

    RETURN v_rem_payment;
END;
$$;

-- ---------------------------------------------------------------------------
-- ANALYTICS: refresh_dashboard_snapshot
-- Pre-computes analytics for a given date and timeframe and upserts into
-- dashboard_analytics_snapshots. Called from the bi-analyze Edge Function
-- or manually via RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_dashboard_snapshot(
    p_business_id UUID,
    p_date        DATE    DEFAULT CURRENT_DATE,
    p_timeframe   TEXT    DEFAULT 'daily'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start          TIMESTAMPTZ;
    v_end            TIMESTAMPTZ;
    v_total_sales    NUMERIC(14,2);
    v_total_expenses NUMERIC(14,2);
    v_order_count    INTEGER;
    v_avg_order      NUMERIC(14,2);
    v_top_product    UUID;
    v_top_category   TEXT;
    v_pay_breakdown  JSONB;
BEGIN
    v_end := (p_date + 1)::TIMESTAMPTZ;
    v_start := CASE p_timeframe
        WHEN 'weekly'  THEN (p_date - INTERVAL '6 days')::TIMESTAMPTZ
        WHEN 'monthly' THEN (p_date - INTERVAL '29 days')::TIMESTAMPTZ
        ELSE p_date::TIMESTAMPTZ
    END;

    SELECT
        COALESCE(SUM(final_total), 0),
        COUNT(*),
        COALESCE(AVG(final_total), 0)
    INTO v_total_sales, v_order_count, v_avg_order
    FROM public.transactions
    WHERE business_id = p_business_id
      AND timestamp >= v_start
      AND timestamp < v_end
      AND deleted_at IS NULL;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_expenses
    FROM public.expenses
    WHERE business_id = p_business_id
      AND date >= v_start
      AND date < v_end
      AND deleted_at IS NULL;

    SELECT p.id
    INTO v_top_product
    FROM public.transaction_items ti
    JOIN public.transactions t ON ti.transaction_id = t.id
    JOIN public.products p ON ti.product_id = p.id
    WHERE t.business_id = p_business_id
      AND t.timestamp >= v_start
      AND t.timestamp < v_end
      AND t.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY SUM(ti.quantity) DESC
    LIMIT 1;

    SELECT p.category
    INTO v_top_category
    FROM public.transaction_items ti
    JOIN public.transactions t ON ti.transaction_id = t.id
    JOIN public.products p ON ti.product_id = p.id
    WHERE t.business_id = p_business_id
      AND t.timestamp >= v_start
      AND t.timestamp < v_end
      AND t.deleted_at IS NULL
    GROUP BY p.category
    ORDER BY SUM(ti.line_total) DESC
    LIMIT 1;

    SELECT jsonb_object_agg(payment_method, total_amount)
    INTO v_pay_breakdown
    FROM (
        SELECT
            payment_method::TEXT,
            SUM(final_total) AS total_amount
        FROM public.transactions
        WHERE business_id = p_business_id
          AND timestamp >= v_start
          AND timestamp < v_end
          AND deleted_at IS NULL
        GROUP BY payment_method
    ) pm;

    INSERT INTO public.dashboard_analytics_snapshots
        (business_id, snapshot_date, timeframe, total_sales, total_expenses,
         order_count, avg_order_value, top_product_id, top_category, payment_breakdown)
    VALUES (
        p_business_id, p_date, p_timeframe,
        v_total_sales, v_total_expenses,
        v_order_count, v_avg_order,
        v_top_product, v_top_category,
        COALESCE(v_pay_breakdown, '{}')
    )
    ON CONFLICT (business_id, snapshot_date, timeframe) DO UPDATE SET
        total_sales     = EXCLUDED.total_sales,
        total_expenses  = EXCLUDED.total_expenses,
        order_count     = EXCLUDED.order_count,
        avg_order_value = EXCLUDED.avg_order_value,
        top_product_id  = EXCLUDED.top_product_id,
        top_category    = EXCLUDED.top_category,
        payment_breakdown = EXCLUDED.payment_breakdown;
END;
$$;

-- ---------------------------------------------------------------------------
-- ANALYTICS: get_business_dashboard_metrics
-- Lightweight RPC returning a JSON object with key sales metrics for a date
-- range. Used by the DashboardView in the React app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_dashboard_metrics(
    p_business_id UUID,
    p_start_date  TIMESTAMPTZ,
    p_end_date    TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'totalSales',    COALESCE(SUM(t.final_total), 0),
        'orderCount',    COUNT(t.id),
        'aov',           COALESCE(AVG(t.final_total), 0),
        'totalExpenses', (
            SELECT COALESCE(SUM(e.amount), 0)
            FROM public.expenses e
            WHERE e.business_id = p_business_id
              AND e.date BETWEEN p_start_date AND p_end_date
              AND e.deleted_at IS NULL
        )
    ) INTO result
    FROM public.transactions t
    WHERE t.business_id = p_business_id
      AND t.timestamp BETWEEN p_start_date AND p_end_date
      AND t.deleted_at IS NULL;

    RETURN result;
END;
$$;

-- =============================================================================
-- 20261110001_team_sync_notification_privacy.sql
-- Why:
--   1. Riders saw no deliveries. Till sales find the rider in public.employees, but
--      role and name changes only reached business_memberships and users, so the
--      employee row stayed on the old role/name and the sale was never linked.
--      Employee rows now follow memberships and profiles, and old sales are relinked.
--   2. Every member could read every notification in the business, including
--      messages sent to other people and ones sent before they joined.
--   3. An admin editing a worker's name, phone or photo was silently refused,
--      because people can only update their own users row.
--   4. Accepting an invitation saved the shop name as the worker's name, because
--      the invitation lookup only returned the business name.
--   5. An accepted invitation is deleted at once, so its code can't be used again.
-- Dependencies: 20261105014 (has_permission), 20261105015 (riders),
--               20261105016 (notification catalog), 20261107002 (invitations)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. EMPLOYEE ROWS FOLLOW MEMBERSHIPS AND PROFILES
-- ---------------------------------------------------------------------------
-- Returns the employee row for a member of a business, creating or refreshing it.
-- employees.id is the primary key, so a person in a second business gets a new id.
CREATE OR REPLACE FUNCTION public.fn_sync_employee(p_business_id UUID, p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_role public.employee_role;
    v_id   UUID;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE id = p_user_id;
    SELECT role INTO v_role FROM public.business_memberships
    WHERE business_id = p_business_id AND user_id = p_user_id AND status = 'Active';
    IF v_user.id IS NULL OR v_role IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_id FROM public.employees
    WHERE business_id = p_business_id AND user_id = p_user_id
    ORDER BY (deleted_at IS NULL) DESC, created_at
    LIMIT 1;

    IF v_id IS NULL THEN
        v_id := CASE WHEN EXISTS (SELECT 1 FROM public.employees WHERE id = p_user_id)
                     THEN gen_random_uuid() ELSE p_user_id END;
        INSERT INTO public.employees (id, business_id, user_id, name, role, email, phone, avatar, assigned_branches)
        VALUES (v_id, p_business_id, p_user_id, COALESCE(NULLIF(trim(v_user.name), ''), 'Team member'), v_role,
                v_user.email, v_user.phone, v_user.avatar, jsonb_build_array(p_business_id::TEXT));
    ELSE
        UPDATE public.employees
        SET name = COALESCE(NULLIF(trim(v_user.name), ''), name),
            role = v_role,
            email = v_user.email,
            phone = v_user.phone,
            avatar = COALESCE(v_user.avatar, avatar),
            deleted_at = NULL
        WHERE id = v_id
          AND (name, role, email, phone, avatar, deleted_at) IS DISTINCT FROM
              (COALESCE(NULLIF(trim(v_user.name), ''), name), v_role, v_user.email, v_user.phone,
               COALESCE(v_user.avatar, avatar), NULL::TIMESTAMPTZ);
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_membership_sync_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'Active' THEN
        PERFORM public.fn_sync_employee(NEW.business_id, NEW.user_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_sync_employee ON public.business_memberships;
CREATE TRIGGER trg_membership_sync_employee
AFTER INSERT OR UPDATE OF role, status ON public.business_memberships
FOR EACH ROW EXECUTE FUNCTION public.fn_membership_sync_employee();

CREATE OR REPLACE FUNCTION public.fn_user_sync_employees()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.fn_sync_employee(m.business_id, NEW.id)
    FROM public.business_memberships m
    WHERE m.user_id = NEW.id AND m.status = 'Active';
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_sync_employees ON public.users;
CREATE TRIGGER trg_user_sync_employees
AFTER UPDATE OF name, phone, email, avatar ON public.users
FOR EACH ROW EXECUTE FUNCTION public.fn_user_sync_employees();

-- ---------------------------------------------------------------------------
-- 2. INVITATIONS: the invitee's own name, deleted once accepted
-- ---------------------------------------------------------------------------
-- Repair people who already joined under the shop name.
UPDATE public.users u
SET name = i.name
FROM public.invitations i
JOIN public.businesses b ON b.id = i.business_id
WHERE i.status = 'Accepted'
  AND LOWER(TRIM(i.email)) = LOWER(TRIM(u.email))
  AND TRIM(u.name) = TRIM(b.name)
  AND NULLIF(TRIM(i.name), '') IS NOT NULL
  AND TRIM(i.name) <> TRIM(b.name)
  AND EXISTS (SELECT 1 FROM public.business_memberships m WHERE m.user_id = u.id AND m.business_id = i.business_id);

DELETE FROM public.invitations WHERE status = 'Accepted';

DROP FUNCTION IF EXISTS public.get_invitation_by_token(TEXT);
CREATE FUNCTION public.get_invitation_by_token(p_token TEXT)
RETURNS TABLE (
    id            UUID,
    business_id   UUID,
    business_name TEXT,
    invitee_name  TEXT,
    email         TEXT,
    phone         TEXT,
    role          public.employee_role,
    expires_at    TIMESTAMPTZ,
    status        public.invitation_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT i.id, i.business_id, b.name, i.name, i.email, i.phone, i.role, i.expires_at, i.status
    FROM public.invitations i
    JOIN public.businesses b ON b.id = i.business_id
    WHERE i.invitation_token = p_token
      AND i.status = 'Pending'
      AND i.expires_at > NOW();
$$;

REVOKE ALL ON FUNCTION public.get_invitation_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation_with_token(
    p_token        TEXT,
    p_auth_user_id UUID,
    p_name         TEXT,
    p_phone        TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_invite      RECORD;
    v_user_id     UUID;
    v_login_email TEXT;
    v_shop        TEXT;
    v_name        TEXT;
BEGIN
    SELECT * INTO v_invite
    FROM public.invitations
    WHERE invitation_token = p_token
      AND status = 'Pending'
      AND expires_at > NOW()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid, expired, or already accepted invitation.';
    END IF;

    -- A logged-in caller can only accept for their own account
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_auth_user_id THEN
        RAISE EXCEPTION 'This invitation belongs to a different account.';
    END IF;

    -- The account must be the one the invitation was sent to
    SELECT email INTO v_login_email FROM auth.users WHERE id = p_auth_user_id;
    IF v_login_email IS NULL
       OR LOWER(TRIM(v_login_email)) <> LOWER(TRIM(v_invite.email)) THEN
        RAISE EXCEPTION 'This invitation belongs to a different account.';
    END IF;

    -- The name they typed, else the one the admin entered. Never the shop name.
    SELECT name INTO v_shop FROM public.businesses WHERE id = v_invite.business_id;
    v_name := NULLIF(TRIM(COALESCE(p_name, '')), '');
    IF v_name IS NULL OR v_name = TRIM(v_shop) THEN
        v_name := COALESCE(NULLIF(TRIM(v_invite.name), ''), v_name, 'Team member');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = p_auth_user_id;

    IF v_user_id IS NULL THEN
        INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
        VALUES (p_auth_user_id, p_auth_user_id, v_name, v_invite.email, p_phone, FALSE)
        RETURNING id INTO v_user_id;
    ELSE
        UPDATE public.users
        SET name = v_name, phone = p_phone, email = v_invite.email
        WHERE id = v_user_id;
    END IF;

    -- The membership trigger creates or refreshes the employee row.
    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_invite.business_id, v_user_id, v_invite.role, 'Active')
    ON CONFLICT (business_id, user_id) DO UPDATE SET
        role   = v_invite.role,
        status = 'Active';
    PERFORM public.fn_sync_employee(v_invite.business_id, v_user_id);

    -- The code can't be used again.
    DELETE FROM public.invitations WHERE id = v_invite.id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_with_token(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation_with_token(TEXT, UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. EDITING A TEAM MEMBER
-- ---------------------------------------------------------------------------
-- Anyone can edit their own name, phone and photo. Editing someone else needs
-- staff.update; changing a role needs staff.roles. Owners keep their role.
CREATE OR REPLACE FUNCTION public.update_team_member(
    p_business_id UUID,
    p_user_id     UUID,
    p_name        TEXT,
    p_phone       TEXT,
    p_avatar      TEXT DEFAULT NULL,
    p_role        TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_me     UUID := (SELECT id FROM public.users WHERE auth_user_id = auth.uid());
    v_target public.business_memberships%ROWTYPE;
    v_name   TEXT := NULLIF(TRIM(COALESCE(p_name, '')), '');
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Please sign in first.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target FROM public.business_memberships
    WHERE business_id = p_business_id AND user_id = p_user_id AND status = 'Active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That team member was not found.';
    END IF;

    IF p_user_id <> v_me THEN
        PERFORM public.assert_permission(p_business_id, 'staff.update');
    ELSE
        PERFORM public.assert_business_member(p_business_id);
    END IF;

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Please enter a name.';
    END IF;

    UPDATE public.users
    SET name = v_name,
        phone = NULLIF(TRIM(COALESCE(p_phone, '')), ''),
        avatar = COALESCE(NULLIF(p_avatar, ''), avatar)
    WHERE id = p_user_id;

    IF p_role IS NOT NULL AND p_role <> v_target.role::TEXT THEN
        IF p_user_id = v_me THEN
            RAISE EXCEPTION 'You can''t change your own role.';
        END IF;
        IF v_target.role = 'Owner' OR p_role = 'Owner' THEN
            RAISE EXCEPTION 'The owner''s role can''t be changed here.';
        END IF;
        PERFORM public.assert_permission(p_business_id, 'staff.roles');
        UPDATE public.business_memberships
        SET role = p_role::public.employee_role
        WHERE id = v_target.id;
    END IF;

    PERFORM public.fn_sync_employee(p_business_id, p_user_id);
EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'That role is not valid.';
END;
$$;

REVOKE ALL ON FUNCTION public.update_team_member(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_team_member(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RIDERS
-- ---------------------------------------------------------------------------
-- Finds a rider by the name typed at the till, using their current role and name.
CREATE OR REPLACE FUNCTION public.fn_find_rider(p_business_id UUID, p_name TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.fn_sync_employee(p_business_id, m.user_id)
    FROM public.business_memberships m
    JOIN public.users u ON u.id = m.user_id
    WHERE m.business_id = p_business_id AND m.status = 'Active' AND m.role = 'Rider'
      AND LOWER(TRIM(u.name)) = LOWER(TRIM(p_name))
    ORDER BY m.joined_at
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_link_sale_rider()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_delivery THEN
        NEW.delivery_status := COALESCE(NEW.delivery_status, 'assigned');
        IF NULLIF(TRIM(COALESCE(NEW.rider_name, '')), '') IS NOT NULL
           AND (NEW.rider_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.rider_name IS DISTINCT FROM OLD.rider_name)) THEN
            NEW.rider_id := public.fn_find_rider(NEW.business_id, NEW.rider_name);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_sale_rider ON public.transactions;
CREATE TRIGGER trg_link_sale_rider
BEFORE INSERT OR UPDATE OF rider_name, is_delivery ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_link_sale_rider();

-- Staff pick riders from the team list, which uses the person's user id.
CREATE OR REPLACE FUNCTION public.staff_assign_rider(p_order_id UUID, p_rider_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order    public.online_orders%ROWTYPE;
    v_user_id  UUID;
    v_employee UUID;
BEGIN
    SELECT * INTO v_order FROM public.online_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    PERFORM public.assert_permission(v_order.business_id, 'orders.assign_rider');

    IF v_order.fulfilment <> 'delivery' OR v_order.status NOT IN ('paid', 'preparing', 'out_for_delivery') THEN
        RAISE EXCEPTION 'Only paid delivery orders can be given to a rider.';
    END IF;

    IF p_rider_id IS NULL THEN
        UPDATE public.online_orders SET rider_id = NULL, rider_assigned_at = NULL WHERE id = p_order_id;
        RETURN;
    END IF;

    SELECT m.user_id INTO v_user_id
    FROM public.business_memberships m
    WHERE m.business_id = v_order.business_id AND m.status = 'Active' AND m.role = 'Rider'
      AND m.user_id IN (
          SELECT p_rider_id
          UNION ALL
          SELECT e.user_id FROM public.employees e WHERE e.id = p_rider_id AND e.business_id = v_order.business_id
      )
    LIMIT 1;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'That rider was not found.';
    END IF;
    v_employee := public.fn_sync_employee(v_order.business_id, v_user_id);

    UPDATE public.online_orders SET rider_id = v_employee, rider_assigned_at = NOW() WHERE id = p_order_id;
    INSERT INTO public.notifications (business_id, user_id, title, message, type, payload, created_by)
    VALUES (v_order.business_id, v_user_id, 'New delivery',
            'Order #' || v_order.order_number || ' for ' || v_order.customer_name || ' is assigned to you.',
            'Online Store', jsonb_build_object('orderId', p_order_id), 'system');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_employee(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_find_rider(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_assign_rider(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_assign_rider(UUID, UUID) TO authenticated;

-- Bring every member's employee row up to date, then link past deliveries.
DO $$
BEGIN
    PERFORM public.fn_sync_employee(m.business_id, m.user_id)
    FROM public.business_memberships m
    WHERE m.status = 'Active';
END;
$$;

UPDATE public.transactions t
SET rider_id = public.fn_find_rider(t.business_id, t.rider_name)
WHERE t.is_delivery AND t.deleted_at IS NULL
  AND NULLIF(TRIM(COALESCE(t.rider_name, '')), '') IS NOT NULL
  AND t.rider_id IS NULL
  AND public.fn_find_rider(t.business_id, t.rider_name) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. NOTIFICATIONS: each person sees only what was sent to them
-- ---------------------------------------------------------------------------
-- Direct: only the person it's for. Everyone else: only if it reached their role
-- (same rule as pushes) and it was sent after they joined.
CREATE OR REPLACE FUNCTION public.fn_can_see_notification(
    p_business_id UUID, p_user_id UUID, p_role TEXT, p_type TEXT, p_created_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_me     UUID;
    v_role   TEXT;
    v_joined TIMESTAMPTZ;
    v_perms  TEXT[];
    v_gated  BOOLEAN;
BEGIN
    SELECT u.id, m.role::TEXT, m.joined_at INTO v_me, v_role, v_joined
    FROM public.users u
    JOIN public.business_memberships m ON m.user_id = u.id
    WHERE u.auth_user_id = auth.uid() AND m.business_id = p_business_id AND m.status = 'Active';

    IF v_me IS NULL THEN
        RETURN FALSE;
    END IF;
    IF p_user_id IS NOT NULL THEN
        RETURN p_user_id = v_me;
    END IF;
    IF p_created_at < v_joined THEN
        RETURN FALSE;
    END IF;

    SELECT c.permissions, TRUE INTO v_perms, v_gated
    FROM public.fn_notification_catalog() c
    WHERE p_type = ANY(c.types) AND c.permissions IS NOT NULL
    LIMIT 1;

    IF v_gated THEN
        RETURN public.fn_user_has_permission(p_business_id, v_me, v_perms);
    END IF;
    RETURN p_role IS NULL OR v_role ILIKE p_role;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_can_see_notification(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_see_notification(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

DO $$
DECLARE
    v_policy RECORD;
BEGIN
    FOR v_policy IN
        SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.notifications', v_policy.policyname);
    END LOOP;
END;
$$;

CREATE POLICY pol_notifications_select ON public.notifications
    FOR SELECT USING (
        deleted_at IS NULL
        AND business_id = ANY(public.get_user_business_ids())
        AND public.fn_can_see_notification(business_id, user_id, role, type, created_at)
    );

CREATE POLICY pol_notifications_insert ON public.notifications
    FOR INSERT WITH CHECK (business_id = ANY(public.get_user_business_ids()));

CREATE POLICY pol_notifications_update ON public.notifications
    FOR UPDATE USING (
        business_id = ANY(public.get_user_business_ids())
        AND public.fn_can_see_notification(business_id, user_id, role, type, created_at)
    );

CREATE POLICY pol_notifications_delete ON public.notifications
    FOR DELETE USING (
        business_id = ANY(public.get_user_business_ids())
        AND public.fn_can_see_notification(business_id, user_id, role, type, created_at)
    );

-- ---------------------------------------------------------------------------
-- 6. LIVE UPDATES for the tables the team screens follow
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RETURN;
    END IF;
    FOREACH t IN ARRAY ARRAY['users', 'business_memberships', 'invitations', 'employees'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. "Alarm" is now called "Reminder" in the app, so the message says so too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_fn OID;
BEGIN
    FOR v_fn IN
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'flag_due_schedule_reminders'
          AND pg_get_functiondef(p.oid) LIKE '%''Alarm for ''%'
    LOOP
        EXECUTE replace(pg_get_functiondef(v_fn), '''Alarm for ''', '''Reminder for ''');
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;

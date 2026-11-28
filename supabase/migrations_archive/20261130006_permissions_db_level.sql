-- Roles and permissions enforced by the database, matching the app.
--
-- 1. Read grants. Many tables had a read rule (RLS policy) but signed-in users had no SELECT
--    grant, so Postgres refused before the rule ran: "permission denied for table invoices".
--    Nobody, the Owner and Admin included, could read invoices, invoice numbers, credit notes,
--    quotes, sales orders/invoices, the books, supplier payments, KRA receipts or points earned.
--    The rules already say who may read; this gives them the grant they need.
-- 2. Tables that only let "Owner or Admin" write now follow the Roles screen, using the same
--    permission the app checks before showing the action (business.update, staff.invite, ...).
--    Tables holding secrets (ai_settings, sms_settings, google_sheets_backup) stay Owner/Admin
--    only; their edge functions check the permission and never return the secret.
-- 3. Only the Owner or an Admin can make, change or remove an Admin, and nobody can change the
--    permissions of their own role. The app already hid these; now the database refuses them.
-- 4. touch_my_presence: every role can mark itself online (the heartbeat wrote to employees,
--    which only Owner/Admin may write, so other roles never showed as online).

-- 1. Read grants -----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          AND p.cmd IN ('SELECT', 'ALL')
          AND (p.roles && ARRAY['public', 'authenticated']::NAME[])
          AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
    LOOP
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.relname);
        RAISE NOTICE 'granted SELECT on %', r.relname;
    END LOOP;
END $$;

-- The API never truncates or adds triggers; signed-in and anonymous users don't need these.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    LOOP
        EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM anon, authenticated', r.relname);
    END LOOP;
END $$;

-- Helpers --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_is_top_role(p_role TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_role IN ('Owner', 'Admin', 'Administrator'), FALSE);
$$;

-- The signed-in person's role in a business, or NULL.
CREATE OR REPLACE FUNCTION public.fn_my_role(p_business_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT bm.role::TEXT
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid() AND bm.business_id = p_business_id AND bm.status = 'Active'
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_my_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_role(UUID) TO authenticated;

-- Who may change a role's permissions: staff.roles, never for Owner/Admin (they always have
-- everything) and never for your own role, unless you are the Owner or an Admin.
CREATE OR REPLACE FUNCTION public.fn_can_edit_role_permissions(p_business_id UUID, p_role TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.is_owner_or_admin(p_business_id)
        OR (public.has_permission(p_business_id, 'staff.roles')
            AND NOT public.fn_is_top_role(p_role)
            AND p_role IS DISTINCT FROM public.fn_my_role(p_business_id));
$$;
REVOKE ALL ON FUNCTION public.fn_can_edit_role_permissions(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_edit_role_permissions(UUID, TEXT) TO authenticated;

-- 2. Policies that follow the Roles screen ----------------------------------------------------

-- Branches and business details: business.update; deleting the business: business.delete.
DROP POLICY IF EXISTS pol_branches_write ON public.branches;
CREATE POLICY pol_branches_write ON public.branches FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_businesses_update ON public.businesses;
CREATE POLICY pol_businesses_update ON public.businesses FOR UPDATE
    USING (public.has_permission(id, 'business.update'))
    WITH CHECK (public.has_permission(id, 'business.update'));

DROP POLICY IF EXISTS pol_businesses_delete ON public.businesses;
CREATE POLICY pol_businesses_delete ON public.businesses FOR DELETE
    USING (public.has_permission(id, 'business.delete'));

-- Staff records: staff.update.
DROP POLICY IF EXISTS pol_employees_write ON public.employees;
CREATE POLICY pol_employees_write ON public.employees FOR ALL
    USING (public.has_permission(business_id, 'staff.update'))
    WITH CHECK (public.has_permission(business_id, 'staff.update'));

-- Team: changing a role needs staff.update or staff.roles, removing someone staff.remove.
-- Adding people goes through invitations (accept_invitation_with_token), so direct inserts
-- stay Owner/Admin.
DROP POLICY IF EXISTS pol_memberships_write ON public.business_memberships;
DROP POLICY IF EXISTS pol_memberships_insert ON public.business_memberships;
CREATE POLICY pol_memberships_insert ON public.business_memberships FOR INSERT
    WITH CHECK (public.is_owner_or_admin(business_id));
DROP POLICY IF EXISTS pol_memberships_update ON public.business_memberships;
CREATE POLICY pol_memberships_update ON public.business_memberships FOR UPDATE
    USING (public.has_permission(business_id, 'staff.update', 'staff.roles'))
    WITH CHECK (public.has_permission(business_id, 'staff.update', 'staff.roles'));
DROP POLICY IF EXISTS pol_memberships_delete ON public.business_memberships;
CREATE POLICY pol_memberships_delete ON public.business_memberships FOR DELETE
    USING (public.has_permission(business_id, 'staff.remove'));

-- Invitations: see with staff.view / invitations.view, send with staff.invite /
-- invitations.create, cancel with invitations.delete / staff.invite.
DROP POLICY IF EXISTS pol_invitations_write ON public.invitations;
DROP POLICY IF EXISTS pol_invitations_select ON public.invitations;
CREATE POLICY pol_invitations_select ON public.invitations FOR SELECT
    USING (public.has_permission(business_id, 'staff.view', 'invitations.view', 'staff.invite', 'invitations.create'));
DROP POLICY IF EXISTS pol_invitations_insert ON public.invitations;
CREATE POLICY pol_invitations_insert ON public.invitations FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'staff.invite', 'invitations.create'));
DROP POLICY IF EXISTS pol_invitations_update ON public.invitations;
CREATE POLICY pol_invitations_update ON public.invitations FOR UPDATE
    USING (public.has_permission(business_id, 'staff.invite', 'invitations.create'))
    WITH CHECK (public.has_permission(business_id, 'staff.invite', 'invitations.create'));
DROP POLICY IF EXISTS pol_invitations_delete ON public.invitations;
CREATE POLICY pol_invitations_delete ON public.invitations FOR DELETE
    USING (public.has_permission(business_id, 'invitations.delete', 'staff.invite'));

-- Role permissions: see fn_can_edit_role_permissions.
DROP POLICY IF EXISTS pol_role_perms_write ON public.role_permissions;
CREATE POLICY pol_role_perms_write ON public.role_permissions FOR ALL
    USING (public.fn_can_edit_role_permissions(business_id, role::TEXT))
    WITH CHECK (public.fn_can_edit_role_permissions(business_id, role::TEXT));

-- Receipt and printer settings: the Receipts & printing screen (settings.tax / settings.update).
DROP POLICY IF EXISTS pol_receipt_settings_write ON public.receipt_settings;
CREATE POLICY pol_receipt_settings_write ON public.receipt_settings FOR ALL
    USING (public.has_permission(business_id, 'settings.tax', 'settings.update'))
    WITH CHECK (public.has_permission(business_id, 'settings.tax', 'settings.update'));

DROP POLICY IF EXISTS pol_printer_settings_write ON public.printer_settings;
CREATE POLICY pol_printer_settings_write ON public.printer_settings FOR ALL
    USING (public.has_permission(business_id, 'settings.tax', 'settings.update'))
    WITH CHECK (public.has_permission(business_id, 'settings.tax', 'settings.update'));

-- Website content: the app lets business.update manage the website.
DROP POLICY IF EXISTS pol_website_settings_write ON public.website_settings;
CREATE POLICY pol_website_settings_write ON public.website_settings FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_website_articles_write ON public.website_articles;
CREATE POLICY pol_website_articles_write ON public.website_articles FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_product_ideas_staff_write ON public.website_product_ideas;
CREATE POLICY pol_product_ideas_staff_write ON public.website_product_ideas FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_website_reviews_staff_update ON public.website_reviews;
CREATE POLICY pol_website_reviews_staff_update ON public.website_reviews FOR UPDATE
    USING (public.has_permission(business_id, 'business.update', 'complaints.reply'))
    WITH CHECK (public.has_permission(business_id, 'business.update', 'complaints.reply'));

DROP POLICY IF EXISTS pol_website_reviews_staff_delete ON public.website_reviews;
CREATE POLICY pol_website_reviews_staff_delete ON public.website_reviews FOR DELETE
    USING (public.has_permission(business_id, 'business.update'));

-- 3. Admin guard ---------------------------------------------------------------------------------
-- Covers direct writes and update_team_member alike. Server jobs (no signed-in user) pass.
CREATE OR REPLACE FUNCTION public.fn_membership_top_role_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_biz UUID := COALESCE(NEW.business_id, OLD.business_id);
BEGIN
    IF auth.uid() IS NULL OR public.is_owner_or_admin(v_biz) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'DELETE' AND public.fn_is_top_role(OLD.role::TEXT) THEN
        RAISE EXCEPTION 'Only the Owner or an Admin can remove an Admin.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role
       AND (public.fn_is_top_role(OLD.role::TEXT) OR public.fn_is_top_role(NEW.role::TEXT)) THEN
        RAISE EXCEPTION 'Only the Owner or an Admin can make someone an Admin.' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_membership_top_role_guard ON public.business_memberships;
CREATE TRIGGER trg_membership_top_role_guard
    BEFORE UPDATE OR DELETE ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_membership_top_role_guard();

-- Invitations: nobody is invited as Owner; only the Owner or an Admin invites an Admin.
CREATE OR REPLACE FUNCTION public.fn_invitation_not_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.role = 'Owner' THEN
        RAISE EXCEPTION 'Nobody can be invited as Owner.' USING ERRCODE = '42501';
    END IF;
    IF public.fn_is_top_role(NEW.role::TEXT) AND auth.uid() IS NOT NULL
       AND NOT public.is_owner_or_admin(NEW.business_id) THEN
        RAISE EXCEPTION 'Only the Owner or an Admin can invite an Admin.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- 4. Presence for every role ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_my_presence(p_business_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.employees e
    SET last_seen_at = NOW()
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND e.user_id = u.id
      AND e.business_id = p_business_id
      AND p_business_id = ANY (public.get_user_business_ids());
$$;
REVOKE ALL ON FUNCTION public.touch_my_presence(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_presence(UUID) TO authenticated;

-- Payments are never deleted from the app (money rule 4: undo is a soft-delete that reverses the
-- balance and books). Signed-in users have no DELETE grant, so this rule never applied.
DROP POLICY IF EXISTS pol_payments_delete ON public.payments;

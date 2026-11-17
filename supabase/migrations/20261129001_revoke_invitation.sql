-- Revoking a staff invitation removes it for good, together with the sign-up
-- the invited person made for it.
--
-- Before: the app deleted the row straight from the table. Only Owners/Admins
-- pass the table's write policy, so for anyone else (with staff.invite) the
-- delete matched nothing and the invitation stayed. And an invited person who
-- had already signed up kept their account, so the email could not be invited
-- again ("A registered user with this email address already exists").
--
-- Now: revoke_invitation() deletes the invitation and any account registered
-- for it (claimed it, or signed up with its email) that has nothing else in
-- the system: no membership in any business, no supplier or website customer
-- account, no other pending invitation, and is not the system creator.
-- Accounts that do have something else are left alone.

CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv      public.invitations%ROWTYPE;
    v_email    TEXT;
    v_auth_id  UUID;
    v_user_id  UUID;
    v_removed  INTEGER := 0;
BEGIN
    SELECT * INTO v_inv FROM public.invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invitation was not found.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (public.is_owner_or_admin(v_inv.business_id)
            OR public.has_permission(v_inv.business_id, 'staff.invite')) THEN
        RAISE EXCEPTION 'You are not allowed to remove invitations.' USING ERRCODE = '42501';
    END IF;

    v_email := LOWER(TRIM(COALESCE(v_inv.email, '')));

    DELETE FROM public.invitations WHERE id = v_inv.id;

    -- Accepted invitations belong to a real member; only the record goes.
    IF v_inv.status = 'Accepted' THEN
        RETURN jsonb_build_object('removed_accounts', 0);
    END IF;

    FOR v_auth_id IN
        SELECT a.id FROM auth.users a
        WHERE a.id = v_inv.claimed_by
           OR (v_email <> '' AND LOWER(TRIM(a.email)) = v_email)
    LOOP
        SELECT u.id INTO v_user_id FROM public.users u WHERE u.auth_user_id = v_auth_id;

        CONTINUE WHEN public.is_system_creator(v_auth_id);
        CONTINUE WHEN v_user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.business_memberships bm WHERE bm.user_id = v_user_id);
        CONTINUE WHEN v_user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.supplier_accounts sa WHERE sa.user_id = v_user_id);
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.customer_accounts ca WHERE ca.id = v_auth_id);
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.invitations i
            WHERE i.status = 'Pending'
              AND (i.claimed_by = v_auth_id
                   OR (v_email <> '' AND LOWER(TRIM(i.email)) = v_email)));

        IF v_user_id IS NOT NULL THEN
            -- trg_on_public_user_deleted removes the auth.users row too.
            DELETE FROM public.users WHERE id = v_user_id;
        END IF;
        DELETE FROM auth.users WHERE id = v_auth_id;
        v_removed := v_removed + 1;
    END LOOP;

    -- Sign-up codes sent to that email are no longer needed.
    IF v_email <> '' AND v_removed > 0 THEN
        DELETE FROM public.otps WHERE LOWER(TRIM(email)) = v_email;
    END IF;

    RETURN jsonb_build_object('removed_accounts', v_removed);
END;
$$;

ALTER FUNCTION public.revoke_invitation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated, service_role;

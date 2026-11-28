-- Who can reach what, as one list of problems (no rows = all good). Read-only.
-- Run on a test build by permissions_test.sh and on the live database by
-- scripts/check-live-grants.sh: live can drift from the migrations (SEC-01, 2026-11-23:
-- Supabase's default privileges had opened 285 server-only functions to anyone).
SELECT problem FROM (
    -- 1. Functions that run with full rights and anyone (not signed in) may call: only these.
    SELECT 'anon can call ' || p.proname AS problem
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN (
          'accept_invitation_with_token', 'assert_business_member', 'check_owner_exists',
          'check_promo_code', 'check_request_session', 'fn_audit_actor_name',
          'fn_can_write_storage_folder', 'fn_storage_folder_permission', 'gen_random_bytes',
          'get_invitation_by_token', 'get_preview_campaigns', 'get_preview_storefront', 'get_public_campaigns', 'get_product_ideas', 'get_public_plans', 'get_public_storefront',
          'get_user_business_ids', 'is_owner_or_admin', 'record_website_view', 'report_crash', 'resolve_website_host', 'session_is_live',
          'submit_website_feedback', 'track_ad_events', 'uuid_generate_v4', 'vat_allowed',
          'website_accepts_airtel', 'website_accepts_cards')
    UNION ALL
    -- 2. Server-only functions (passwords, codes, payment callbacks, books): no app role at all.
    SELECT r.rolname || ' can call server-only ' || p.proname
    FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname IN ('update_user_password_by_email', 'settle_card_payment', 'record_till_payment',
                         'confirm_online_order_payment', 'confirm_store_payment_request',
                         'confirm_airtel_payment', 'fn_post_money_asset', 'acc_apply',
                         'find_auth_user_by_phone', 'find_account_by_auth_phone',
                         'fn_create_customer_account', 'fn_build_online_order',
                         'check_rate_limit', 'log_security_event', 'purge_security_data',
                         'request_ip', 'ops_watchdog_checks', 'ops_watchdog_core_checks')
           OR p.proname LIKE 'otp\_%')
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    UNION ALL
    -- 3. RLS does not apply to TRUNCATE, so no app role may have it on a table.
    SELECT r.rolname || ' can TRUNCATE ' || c.relname
    FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
    UNION ALL
    -- 4. Someone not signed in reads or writes no table directly.
    SELECT 'anon has ' || x.priv || ' on ' || c.relname
    FROM pg_class c CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) x(priv)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND has_table_privilege('anon', c.oid, x.priv)
    UNION ALL
    -- 5. Every table has row level security on.
    SELECT 'RLS off on ' || c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    UNION ALL
    -- 6. Every business table obeys read-only plans (20261204001), except the listed housekeeping.
    SELECT 'no read-only plan check on ' || c.relname
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND c.relname NOT IN ('audit_logs', 'notifications', 'notification_preferences',
                            'business_memberships', 'crash_reports', 'problem_reports',
                            'support_grants', 'module_requests', 'support_messages', 'website_visit_daily',
                            'marketing_ad_daily', 'marketing_conversions', 'canva_oauth_states',
                            -- Server-only Daraja plumbing: a payment arriving for a business on an
                            -- ended plan must still be stored (money rule 1).
                            'daraja_callbacks', 'mpesa_callback_tokens')
      AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'trg_zz_plan_read_only')
) problems
ORDER BY 1;

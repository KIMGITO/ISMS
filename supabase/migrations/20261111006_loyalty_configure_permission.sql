-- Points settings (on/off, tier values, fewest points to use) follow the "loyalty.configure"
-- permission instead of owner/admin only, so the app and the database agree on who may change
-- them. Owners and admins still pass: has_permission() says yes to them for everything.
-- Anyone in the business may still read the settings (till, receipts and website need them).

DROP POLICY IF EXISTS pol_loyalty_settings_write ON public.loyalty_settings;
DROP POLICY IF EXISTS pol_loyalty_settings_insert ON public.loyalty_settings;
DROP POLICY IF EXISTS pol_loyalty_settings_update ON public.loyalty_settings;

CREATE POLICY pol_loyalty_settings_insert ON public.loyalty_settings FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'loyalty.configure'));

CREATE POLICY pol_loyalty_settings_update ON public.loyalty_settings FOR UPDATE
    USING (public.has_permission(business_id, 'loyalty.configure'))
    WITH CHECK (public.has_permission(business_id, 'loyalty.configure'));

-- No DELETE policy: settings are switched off, never removed (DELETE was never granted).

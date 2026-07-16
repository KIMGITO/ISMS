-- Integration Configurations (Centralized JSON store for integrations like AI, Email, SMS, etc.)

CREATE TABLE IF NOT EXISTS public.integration_configurations (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id          UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    section              TEXT NOT NULL,
    payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, section)
);

ALTER TABLE public.integration_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_integration_configurations_select ON public.integration_configurations;
CREATE POLICY pol_integration_configurations_select ON public.integration_configurations FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_integration_configurations_write ON public.integration_configurations;
CREATE POLICY pol_integration_configurations_write ON public.integration_configurations FOR ALL USING (public.is_owner_or_admin(business_id));

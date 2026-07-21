-- =============================================================================
-- 20260719_002_bom_rls_policies.sql
-- Add missing INSERT/UPDATE/DELETE RLS policies for BOM tables
-- =============================================================================

BEGIN;

-- bill_of_materials policies
CREATE POLICY "Users can insert BOMs for their business"
    ON public.bill_of_materials
    FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT bm.business_id
            FROM public.business_memberships bm
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update BOMs for their business"
    ON public.bill_of_materials
    FOR UPDATE
    USING (
        business_id IN (
            SELECT bm.business_id
            FROM public.business_memberships bm
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete BOMs for their business"
    ON public.bill_of_materials
    FOR DELETE
    USING (
        business_id IN (
            SELECT bm.business_id
            FROM public.business_memberships bm
            WHERE bm.user_id = auth.uid()
        )
    );

-- bom_ingredients policies
CREATE POLICY "Users can insert BOM ingredients for their business"
    ON public.bom_ingredients
    FOR INSERT
    WITH CHECK (
        bom_id IN (
            SELECT bom.id
            FROM public.bill_of_materials bom
            JOIN public.business_memberships bm ON bm.business_id = bom.business_id
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete BOM ingredients for their business"
    ON public.bom_ingredients
    FOR DELETE
    USING (
        bom_id IN (
            SELECT bom.id
            FROM public.bill_of_materials bom
            JOIN public.business_memberships bm ON bm.business_id = bom.business_id
            WHERE bm.user_id = auth.uid()
        )
    );

COMMIT;
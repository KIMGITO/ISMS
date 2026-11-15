-- =============================================================================
-- 20261114005_product_ideas.sql
--
-- "Vote & suggest" on the website (/ideas):
--   * Staff post products that are coming (kind 'upcoming') and customers vote for them.
--   * Signed-in customers suggest products (kind 'suggestion'). A suggestion waits for staff
--     ('pending') before anyone else sees it, the same way reviews do.
--   * One vote per customer account per idea. The count is kept on the idea (vote_count) by
--     the voting function, so the public list is one cheap query.
--
-- Statuses: pending (suggestion waiting for staff) → open (voting) → planned (we'll make it)
-- → available (on sale; product_id links to it). hidden takes it off the website.
--
-- Customers only use the functions below. Staff (owners and admins) manage ideas directly
-- in Online Store → Product ideas, like reviews.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.website_product_ideas (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('upcoming', 'suggestion')),
    title          TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 80),
    description    TEXT CHECK (description IS NULL OR length(description) <= 500),
    image_url      TEXT CHECK (image_url IS NULL OR (image_url ~ '^https://' AND length(image_url) <= 1000)),
    -- Short public line from staff, e.g. "Coming in December" or "Thanks, we're looking into it".
    staff_note     TEXT CHECK (staff_note IS NULL OR length(staff_note) <= 300),
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('pending', 'open', 'planned', 'available', 'hidden')),
    product_id     UUID REFERENCES public.products(id) ON DELETE SET NULL,
    suggested_by   UUID REFERENCES public.customer_accounts(id) ON DELETE SET NULL,
    -- "Jane W.", never a full name (fn_review_display_name).
    suggested_name TEXT CHECK (suggested_name IS NULL OR length(suggested_name) <= 60),
    vote_count     INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_ideas_public
    ON public.website_product_ideas (business_id, status, vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_product_ideas_suggested_by
    ON public.website_product_ideas (suggested_by) WHERE suggested_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.website_product_idea_votes (
    idea_id    UUID NOT NULL REFERENCES public.website_product_ideas(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (idea_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_product_idea_votes_account ON public.website_product_idea_votes (account_id);

ALTER TABLE public.website_product_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_product_idea_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_product_ideas, public.website_product_idea_votes FROM anon;
REVOKE ALL ON public.website_product_idea_votes FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_product_ideas TO authenticated;
GRANT ALL ON public.website_product_ideas, public.website_product_idea_votes TO service_role;

DROP POLICY IF EXISTS pol_product_ideas_staff_select ON public.website_product_ideas;
CREATE POLICY pol_product_ideas_staff_select ON public.website_product_ideas FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));
DROP POLICY IF EXISTS pol_product_ideas_staff_write ON public.website_product_ideas;
CREATE POLICY pol_product_ideas_staff_write ON public.website_product_ideas FOR ALL
    USING (public.is_owner_or_admin(business_id))
    WITH CHECK (public.is_owner_or_admin(business_id));

-- Staff can't type a vote count; only fn votes change it.
CREATE OR REPLACE FUNCTION public.fn_product_ideas_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF current_setting('app.idea_votes', TRUE) IS DISTINCT FROM 'on' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.vote_count := 0;
        ELSE
            NEW.vote_count := OLD.vote_count;
        END IF;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_product_ideas_guard ON public.website_product_ideas;
CREATE TRIGGER trg_product_ideas_guard
    BEFORE INSERT OR UPDATE ON public.website_product_ideas
    FOR EACH ROW EXECUTE FUNCTION public.fn_product_ideas_guard();

-- The public list. Signed-in customers also see which ideas they voted for and their own
-- suggestions that are still waiting for staff.
CREATE OR REPLACE FUNCTION public.get_product_ideas(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'kind', i.kind,
        'title', i.title,
        'description', i.description,
        'imageUrl', i.image_url,
        'staffNote', i.staff_note,
        'status', i.status,
        'productId', CASE WHEN i.status = 'available' THEN i.product_id END,
        'suggestedBy', i.suggested_name,
        'votes', i.vote_count,
        'voted', EXISTS (SELECT 1 FROM public.website_product_idea_votes v WHERE v.idea_id = i.id AND v.account_id = auth.uid()),
        'mine', i.suggested_by IS NOT NULL AND i.suggested_by = auth.uid(),
        'createdAt', i.created_at
    ) ORDER BY
        CASE i.status WHEN 'open' THEN 0 WHEN 'planned' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
        i.sort_order DESC, i.vote_count DESC, i.created_at DESC), '[]'::jsonb)
    FROM public.website_product_ideas i
    JOIN public.businesses b ON b.id = i.business_id
    WHERE b.website_slug = p_slug AND b.deleted_at IS NULL
      AND (i.status IN ('open', 'planned', 'available')
           OR (i.status = 'pending' AND i.suggested_by IS NOT NULL AND i.suggested_by = auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.get_product_ideas(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_ideas(TEXT) TO anon, authenticated;

-- A customer suggests a product. Waits for staff before it shows to others. The suggester's
-- own vote is counted straight away.
CREATE OR REPLACE FUNCTION public.suggest_product_idea(p_title TEXT, p_description TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account public.customer_accounts%ROWTYPE;
    v_title   TEXT := regexp_replace(trim(COALESCE(p_title, '')), '\s+', ' ', 'g');
    v_desc    TEXT := NULLIF(trim(COALESCE(p_description, '')), '');
    v_same    public.website_product_ideas%ROWTYPE;
    v_id      UUID;
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please sign in to suggest a product.';
    END IF;
    IF length(v_title) < 3 THEN
        RAISE EXCEPTION 'Please name the product you would like, in at least 3 letters.';
    END IF;
    IF length(v_title) > 80 THEN
        RAISE EXCEPTION 'Please keep the product name under 80 characters. Put the details in the description.';
    END IF;
    IF length(v_desc) > 500 THEN
        RAISE EXCEPTION 'Please keep the description under 500 characters.';
    END IF;

    SELECT * INTO v_same FROM public.website_product_ideas
    WHERE business_id = v_account.business_id AND lower(title) = lower(v_title) AND status <> 'hidden'
    LIMIT 1;
    IF FOUND THEN
        IF v_same.status IN ('open', 'planned') THEN
            RAISE EXCEPTION '"%" is already on the list. Vote for it there instead.', v_same.title;
        ELSIF v_same.status = 'available' THEN
            RAISE EXCEPTION 'Good news: "%" is already in our shop.', v_same.title;
        ELSE
            RAISE EXCEPTION 'Someone has already suggested "%". We will add it to the list once we have looked at it.', v_same.title;
        END IF;
    END IF;

    IF (SELECT count(*) FROM public.website_product_ideas
        WHERE suggested_by = v_account.id AND created_at > NOW() - INTERVAL '1 day') >= 3 THEN
        RAISE EXCEPTION 'You can suggest up to 3 products a day. Please try again tomorrow.';
    END IF;

    INSERT INTO public.website_product_ideas
        (business_id, kind, title, description, status, suggested_by, suggested_name, created_by)
    VALUES
        (v_account.business_id, 'suggestion', v_title, v_desc, 'pending', v_account.id,
         public.fn_review_display_name(v_account.name), 'Website')
    RETURNING id INTO v_id;

    PERFORM set_config('app.idea_votes', 'on', TRUE);
    INSERT INTO public.website_product_idea_votes (idea_id, account_id) VALUES (v_id, v_account.id);
    UPDATE public.website_product_ideas SET vote_count = 1 WHERE id = v_id;
    PERFORM set_config('app.idea_votes', 'off', TRUE);

    PERFORM public.fn_notify_staff(v_account.business_id, 'New product suggestion',
        format('%s suggested "%s" on the website. Approve it in Online Store → Product ideas.',
               public.fn_review_display_name(v_account.name), v_title),
        jsonb_build_object('ideaId', v_id));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.suggest_product_idea(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_product_idea(TEXT, TEXT) TO authenticated;

-- Adds or takes back the customer's vote. Returns the new count and whether they now vote.
CREATE OR REPLACE FUNCTION public.vote_product_idea(p_idea_id UUID, p_vote BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account public.customer_accounts%ROWTYPE;
    v_idea    public.website_product_ideas%ROWTYPE;
    v_changed INTEGER;
    v_count   INTEGER;
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please sign in to vote.';
    END IF;
    SELECT * INTO v_idea FROM public.website_product_ideas
    WHERE id = p_idea_id AND business_id = v_account.business_id
    FOR UPDATE;
    IF NOT FOUND OR v_idea.status IN ('hidden', 'pending') THEN
        RAISE EXCEPTION 'That idea is no longer on the list.';
    END IF;
    IF v_idea.status = 'available' THEN
        RAISE EXCEPTION 'Voting has closed: "%" is already in our shop.', v_idea.title;
    END IF;

    IF COALESCE(p_vote, TRUE) THEN
        INSERT INTO public.website_product_idea_votes (idea_id, account_id)
        VALUES (v_idea.id, v_account.id)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.website_product_idea_votes WHERE idea_id = v_idea.id AND account_id = v_account.id;
    END IF;
    GET DIAGNOSTICS v_changed = ROW_COUNT;

    SELECT count(*) INTO v_count FROM public.website_product_idea_votes WHERE idea_id = v_idea.id;
    IF v_changed > 0 THEN
        PERFORM set_config('app.idea_votes', 'on', TRUE);
        UPDATE public.website_product_ideas SET vote_count = v_count WHERE id = v_idea.id;
        PERFORM set_config('app.idea_votes', 'off', TRUE);
    END IF;

    RETURN jsonb_build_object('votes', v_count, 'voted', COALESCE(p_vote, TRUE));
END;
$$;
REVOKE ALL ON FUNCTION public.vote_product_idea(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vote_product_idea(UUID, BOOLEAN) TO authenticated;

COMMIT;

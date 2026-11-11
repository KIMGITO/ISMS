-- Loyalty points can be switched off per business (Online Store > Settings > Loyalty points).
--
-- While off:
--   * nothing earns points. Every earning route adds to customers.loyalty_points and then
--     logs the same amount in loyalty_points_earned; a trigger on that log takes the points
--     back off and skips the row. So no earning function had to be rewritten.
--   * tiers don't rise (they only rise with earned points).
--   * nothing spends points: any insert into loyalty_redemptions is refused.
--   * balances stay as they are. Refunds of points spent earlier and customer merges still
--     move points, so nobody loses what they had. Switching back on carries on from there.
--   * the app and website hide points (loyalty.enabled / enabled below).

BEGIN;

ALTER TABLE public.loyalty_settings
    ADD COLUMN IF NOT EXISTS points_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION public.fn_points_on(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((SELECT points_enabled FROM public.loyalty_settings WHERE business_id = p_business_id), TRUE);
$$;
REVOKE ALL ON FUNCTION public.fn_points_on(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_points_on(UUID) TO authenticated, service_role;

-- Earning while off: undo the points just added and don't log them.
CREATE OR REPLACE FUNCTION public.fn_cancel_points_when_off()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.fn_points_on(NEW.business_id) THEN
        RETURN NEW;
    END IF;
    UPDATE public.customers
    SET loyalty_points = GREATEST(0, loyalty_points - NEW.points)
    WHERE id = NEW.customer_id;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_points_when_off ON public.loyalty_points_earned;
CREATE TRIGGER trg_cancel_points_when_off
BEFORE INSERT ON public.loyalty_points_earned
FOR EACH ROW EXECUTE FUNCTION public.fn_cancel_points_when_off();

-- The sale log must run after the sale's points are added (AFTER triggers run in name order,
-- and trg_log_sale_points came before trg_process_completed_transaction). Renamed so it sorts
-- last; don't bring the old name back.
DROP TRIGGER IF EXISTS trg_log_sale_points ON public.transactions;
DROP TRIGGER IF EXISTS trg_sale_points_logged ON public.transactions;
CREATE TRIGGER trg_sale_points_logged
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_log_sale_points();

-- Tiers don't rise while points are off (points added there are about to be taken back).
CREATE OR REPLACE FUNCTION public.fn_raise_customer_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.loyalty_points > OLD.loyalty_points AND public.fn_points_on(NEW.business_id) THEN
        NEW.tier := GREATEST(NEW.tier, public.calculate_customer_tier(NEW.loyalty_points));
    END IF;
    RETURN NEW;
END;
$$;

-- Spending while off is refused, at the till, on the customer page and online.
CREATE OR REPLACE FUNCTION public.fn_block_redemption_when_off()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.fn_points_on(NEW.business_id) THEN
        RAISE EXCEPTION 'Loyalty points are switched off.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_redemption_when_off ON public.loyalty_redemptions;
CREATE TRIGGER trg_block_redemption_when_off
BEFORE INSERT ON public.loyalty_redemptions
FOR EACH ROW EXECUTE FUNCTION public.fn_block_redemption_when_off();

-- Customer's own rewards page: says whether points are on.
CREATE OR REPLACE FUNCTION public.get_my_rewards()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'points', c.loyalty_points,
        'tier', c.tier,
        'wallet', c.wallet_balance,
        'debt', c.debt_balance,
        'pointValue', public.fn_point_value(c.business_id, c.tier),
        'minRedeem', COALESCE(s.min_redeem_points, 100),
        'enabled', COALESCE(s.points_enabled, TRUE)
    )
    FROM public.customer_accounts a
    JOIN public.customers c ON c.id = a.customer_id
    LEFT JOIN public.loyalty_settings s ON s.business_id = c.business_id
    WHERE a.id = auth.uid();
$$;

-- Website: same as 20261111002 plus loyalty.enabled.
CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'business', jsonb_build_object(
            'name', b.name,
            'description', b.description,
            'address', b.address,
            'contactEmail', NULLIF(b.contact_email, ''),
            'contactPhone', NULLIF(b.contact_phone, ''),
            'logoUrl', b.logo_url,
            'coverImageUrl', b.cover_image_url,
            'primaryColor', b.primary_color,
            'currency', b.currency,
            'paymentMethods', to_jsonb(b.default_payment_methods)
        ),
        'settings', jsonb_build_object(
            'deliveryEnabled', COALESCE(s.delivery_enabled, TRUE),
            'deliveryFee', COALESCE(s.delivery_fee, 0),
            'minOrder', COALESCE(s.min_order, 0),
            'assistantEnabled', COALESCE(s.assistant_enabled, TRUE),
            'openingHours', NULLIF(trim(s.opening_hours), ''),
            'whatsapp', NULLIF(trim(s.whatsapp), '')
        ),
        'pages', COALESCE(s.pages, '{}'::jsonb),
        -- Home page slides from Online Store > Home banner; hidden ones never leave the database.
        'heroSlides', COALESCE((
            SELECT jsonb_agg(slide) FROM jsonb_array_elements(s.hero_slides) AS slide
            WHERE COALESCE((slide->>'hidden')::boolean, FALSE) IS FALSE
        ), '[]'::jsonb),
        'loyalty', jsonb_build_object(
            'enabled', COALESCE(l.points_enabled, TRUE),
            'pointsPerShilling', 2,
            'valueBronze', COALESCE(l.value_bronze, 0.02),
            'valueSilver', COALESCE(l.value_silver, 0.01),
            'valueGold', COALESCE(l.value_gold, 0.005),
            'minRedeem', COALESCE(l.min_redeem_points, 100)
        ),
        'reviews', COALESCE((
            SELECT jsonb_agg(r ORDER BY r->>'createdAt' DESC)
            FROM (
                SELECT jsonb_build_object(
                    'id', rv.id,
                    'productId', rv.product_id,
                    'rating', rv.rating,
                    'title', rv.title,
                    'body', rv.body,
                    'name', rv.display_name,
                    'verified', rv.verified,
                    'featured', rv.featured,
                    'reply', rv.staff_reply,
                    'createdAt', rv.created_at
                ) AS r
                FROM public.website_reviews rv
                WHERE rv.business_id = b.id AND rv.status = 'approved'
                ORDER BY rv.featured DESC, rv.created_at DESC
                LIMIT 300
            ) recent
        ), '[]'::jsonb),
        'promotions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'code', pc.code,
                'description', pc.description,
                'kind', pc.kind,
                'value', pc.value,
                'minOrder', pc.min_order,
                'endsAt', pc.ends_at
            ) ORDER BY pc.created_at DESC)
            FROM public.website_promo_codes pc
            WHERE pc.business_id = b.id AND pc.active AND pc.show_on_website
              AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
              AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
        ), '[]'::jsonb),
        'deliveryZones', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'fee', z.fee) ORDER BY z.name)
            FROM public.delivery_zones z
            WHERE z.business_id = b.id AND z.active
        ), '[]'::jsonb),
        'branches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', br.name, 'address', br.address) ORDER BY br.name)
            FROM public.branches br
            WHERE br.business_id = b.id AND br.deleted_at IS NULL
        ), '[]'::jsonb),
        'products', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', p.id,
                'name', p.name,
                'category', p.category,
                'price', p.price,
                'unit', p.unit,
                'description', p.description,
                'image', p.image,
                'inStock', p.stock > 0
            ) ORDER BY p.category, p.name)
            FROM public.products p
            WHERE p.business_id = b.id
              AND p.deleted_at IS NULL
              AND p.show_on_website
              AND p.price > 0
        ), '[]'::jsonb),
        'articles', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', a.id,
                'slug', a.slug,
                'title', a.title,
                'summary', a.summary,
                'body', a.body,
                'category', a.category,
                'coverImageUrl', a.cover_image_url,
                'publishedAt', a.published_at
            ) ORDER BY a.published_at DESC)
            FROM public.website_articles a
            WHERE a.business_id = b.id AND a.published
        ), '[]'::jsonb)
    )
    FROM public.businesses b
    LEFT JOIN public.website_settings s ON s.business_id = b.id
    LEFT JOIN public.loyalty_settings l ON l.business_id = b.id
    WHERE b.website_slug = p_slug
      AND b.deleted_at IS NULL;
$$;

COMMIT;

-- Performance test data (Phase 8), loaded on top of supabase/tests/promotions/fixtures.sql in
-- a throwaway copy (perf_test). Never run this on live.
--
-- Branch "Main" (b1…) gets a busy shop's history: :sales sales of 3 lines each over the last
-- year, 2,000 products, 2,000 customers, 30,000 stock movements, 5,000 notifications.
-- 9 other businesses get a fifth of that each, so every query has to pick one business out of
-- many (as on a shared live database).
-- Triggers are off while loading (session_replication_role = replica): this measures reads and
-- new sales against a big history, not how fast the history was written.
\set ON_ERROR_STOP 1
\if :{?sales}
\else
  \set sales 50000
\endif
SET session_replication_role = replica;

-- 9 more businesses, owned by the test owner.
INSERT INTO public.businesses (id, name)
SELECT ('b9' || lpad(g::text, 6, '0') || '-0000-0000-0000-000000000000')::uuid, 'Perf shop ' || g
FROM generate_series(1, 9) g ON CONFLICT DO NOTHING;
INSERT INTO public.business_memberships (business_id, user_id, role, status)
SELECT ('b9' || lpad(g::text, 6, '0') || '-0000-0000-0000-000000000000')::uuid,
       '00000000-0000-0000-0000-0000000000a0', 'Owner', 'Active'
FROM generate_series(1, 9) g ON CONFLICT DO NOTHING;

CREATE TEMP TABLE biz AS
SELECT 'b1000000-0000-0000-0000-000000000000'::uuid id, 1.0 share
UNION ALL SELECT ('b9' || lpad(g::text, 6, '0') || '-0000-0000-0000-000000000000')::uuid, 0.2
FROM generate_series(1, 9) g;

INSERT INTO public.products (business_id, name, category, price, cost, stock, min_stock, sku)
SELECT b.id, 'Product ' || g, 'Cat ' || (g % 40), 50 + (g % 500), 30 + (g % 300), 1000000, 5, 'SKU' || g
FROM biz b, generate_series(1, 2000) g WHERE g <= 2000 * b.share;

INSERT INTO public.customers (business_id, name, phone)
SELECT b.id, 'Customer ' || g, '07' || lpad(g::text, 8, '0')
FROM biz b, generate_series(1, 2000) g WHERE g <= 2000 * b.share;

CREATE TEMP TABLE prod AS
SELECT business_id, id, name, price, row_number() OVER (PARTITION BY business_id ORDER BY id) n,
       count(*) OVER (PARTITION BY business_id) c
FROM public.products WHERE business_id IN (SELECT id FROM biz);
CREATE INDEX ON prod (business_id, n);
CREATE TEMP TABLE cust AS
SELECT business_id, id, row_number() OVER (PARTITION BY business_id ORDER BY id) n
FROM public.customers WHERE business_id IN (SELECT id FROM biz);
CREATE INDEX ON cust (business_id, n);

INSERT INTO public.transactions (id, business_id, total, discount, tax, final_total, amount_paid,
  payment_method, customer_id, staff_id, staff_name, status, timestamp, created_at)
SELECT gen_random_uuid(), b.id, 300, 0, 0, 300, 300,
  (ARRAY['Cash','M-Pesa','Card'])[1 + g % 3]::public.payment_method,
  CASE WHEN g % 4 = 0 THEN c.id END,
  CASE WHEN b.id = 'b1000000-0000-0000-0000-000000000000' AND g % 2 = 0 THEN 'e2000000-0000-0000-0000-000000000000'::uuid END,
  'Staff', 'Synced', now() - (g * interval '1 year' / :sales), now() - (g * interval '1 year' / :sales)
FROM biz b CROSS JOIN generate_series(1, :sales) g
LEFT JOIN cust c ON c.business_id = b.id AND c.n = 1 + g % 300
WHERE g <= :sales * b.share;

CREATE TEMP TABLE pc AS SELECT business_id, count(*) c FROM prod GROUP BY 1;
INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total, unit_cost, created_at)
SELECT l.tid, p.id, p.name, p.price, 1, 0, p.price, 30, l.created_at
FROM (
  SELECT t.id tid, t.business_id, t.created_at, 1 + (abs(hashtext(t.id::text)::bigint) + k * 7919) % pc.c AS n
  FROM public.transactions t JOIN pc ON pc.business_id = t.business_id CROSS JOIN generate_series(0, 2) k
  WHERE t.staff_name = 'Staff'
) l
JOIN prod p ON p.business_id = l.business_id AND p.n = l.n;

INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock, timestamp, reason, staff_name)
SELECT p.business_id, p.id, p.name, 'Restock', 10, 100, 110, now() - (g * interval '1 year' / 30000), 'perf', 'Staff'
FROM biz b CROSS JOIN generate_series(1, 30000) g
JOIN pc ON pc.business_id = b.id
JOIN prod p ON p.business_id = b.id AND p.n = 1 + g % pc.c
WHERE g <= 30000 * b.share;

INSERT INTO public.notifications (business_id, title, message, type, created_at)
SELECT b.id, 'Low stock', 'Product is low', 'stock', now() - (g * interval '1 year' / 5000)
FROM biz b, generate_series(1, 5000) g WHERE g <= 5000 * b.share;

SET session_replication_role = DEFAULT;
ANALYZE;
SELECT (SELECT count(*) FROM public.transactions) sales, (SELECT count(*) FROM public.transaction_items) lines,
       (SELECT count(*) FROM public.products) products, (SELECT count(*) FROM public.inventory_adjustments) stock_moves;

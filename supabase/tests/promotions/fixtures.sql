-- Test fixtures: two branches of one owner, staff of each role, products, customers.
INSERT INTO auth.users (id, email, aud, role) VALUES
 ('a0000000-0000-0000-0000-000000000000','owner@t.test','authenticated','authenticated'),
 ('a1000000-0000-0000-0000-000000000000','mgr@t.test','authenticated','authenticated'),
 ('a2000000-0000-0000-0000-000000000000','cash@t.test','authenticated','authenticated'),
 ('a3000000-0000-0000-0000-000000000000','rider@t.test','authenticated','authenticated')
ON CONFLICT DO NOTHING;
DELETE FROM public.users WHERE auth_user_id::text LIKE 'a_000000-%' AND id::text NOT LIKE '00000000-%';
INSERT INTO public.users (id, auth_user_id, name, email) VALUES
 ('00000000-0000-0000-0000-0000000000a0','a0000000-0000-0000-0000-000000000000','Olive Owner','owner@t.test'),
 ('00000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000000','Mary Manager','mgr@t.test'),
 ('00000000-0000-0000-0000-0000000000a2','a2000000-0000-0000-0000-000000000000','Carl Cashier','cash@t.test'),
 ('00000000-0000-0000-0000-0000000000a3','a3000000-0000-0000-0000-000000000000','Ray Rider','rider@t.test')
ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id;
INSERT INTO public.businesses (id, name) VALUES
 ('b1000000-0000-0000-0000-000000000000','Main'),('b2000000-0000-0000-0000-000000000000','Branch Two') ON CONFLICT DO NOTHING;
INSERT INTO public.business_memberships (business_id, user_id, role, status) VALUES
 ('b1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a0','Owner','Active'),
 ('b2000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a0','Owner','Active'),
 ('b1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','Manager','Active'),
 ('b1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','Cashier','Active'),
 ('b2000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','Cashier','Active'),
 ('b1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3','Rider','Active')
ON CONFLICT DO NOTHING;
INSERT INTO public.employees (id, business_id, user_id, name, role) VALUES
 ('e2000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','Carl Cashier','Cashier'),
 ('e2000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','Carl Cashier','Cashier'),
 ('e1000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','Mary Manager','Manager')
ON CONFLICT DO NOTHING;
INSERT INTO public.products (id, business_id, name, category, price, cost, stock) VALUES
 ('d1000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','Milk 1L','Milk',100,60,10000),
 ('d2000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','Milk 500ml','Milk',60,35,10000),
 ('d3000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','Bread','Bakery',50,30,10000),
 ('d4000000-0000-0000-0000-000000000000','b2000000-0000-0000-0000-000000000000','Milk 1L','Milk',100,60,10000)
ON CONFLICT DO NOTHING;
INSERT INTO public.customers (id, business_id, name, phone) VALUES
 ('c1000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','Alice Old','0711000001'),
 ('c2000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','Bob New','0711000002'),
 ('c3000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000000','Carol Chosen','0711000003')
ON CONFLICT DO NOTHING;
-- Alice has bought before.
INSERT INTO public.transactions (business_id, total, final_total, amount_paid, payment_method, customer_id, customer_name, staff_name)
SELECT 'b1000000-0000-0000-0000-000000000000', 100, 100, 100, 'Cash', 'c1000000-0000-0000-0000-000000000000', 'Alice Old', 'Seed'
WHERE NOT EXISTS (SELECT 1 FROM public.transactions WHERE customer_id = 'c1000000-0000-0000-0000-000000000000');
-- The test company is on Pro Plus with no end date, as every business was when plans came in
-- (20261204001). saas/plans_test.sh moves it between plans itself.
UPDATE public.tenant_subscriptions SET plan_code = 'pro_plus', status = 'active', billing_cycle = 'manual',
       trial_ends_at = NULL, current_period_end = NULL
WHERE tenant_id = (SELECT tenant_id FROM public.businesses WHERE id = 'b1000000-0000-0000-0000-000000000000');

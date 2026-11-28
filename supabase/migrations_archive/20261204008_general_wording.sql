-- The app serves any kind of shop, so a new website guide no longer starts in a dairy category.
-- Existing guides keep the category their shop gave them.
ALTER TABLE public.website_articles ALTER COLUMN category SET DEFAULT 'Guides';

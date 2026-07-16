-- 20260709130000_invite_validation_and_business_fields.sql

-- 1. Add business management fields to public.businesses
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS primary_color TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS secondary_color TEXT;

-- 2. Add backend validation check constraints on public.businesses
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS chk_businesses_name;
ALTER TABLE public.businesses ADD CONSTRAINT chk_businesses_name
    CHECK (length(trim(name)) > 0);

ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS chk_businesses_contact_email;
ALTER TABLE public.businesses ADD CONSTRAINT chk_businesses_contact_email 
    CHECK (contact_email IS NULL OR contact_email = '' OR contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS chk_businesses_contact_phone;
ALTER TABLE public.businesses ADD CONSTRAINT chk_businesses_contact_phone
    CHECK (contact_phone IS NULL OR contact_phone = '' OR contact_phone ~* '^\+[1-9]\d{1,14}$');

-- 3. Add backend validation trigger on public.invitations
CREATE OR REPLACE FUNCTION public.fn_check_invitation_email()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if user exists in public.users
    IF EXISTS (
        SELECT 1 FROM public.users WHERE email = NEW.email
    ) THEN
        RAISE EXCEPTION 'A registered user with this email address already exists in the system.';
    END IF;

    -- Check if active invitation exists in public.invitations
    IF EXISTS (
        SELECT 1 FROM public.invitations 
        WHERE email = NEW.email 
          AND status = 'Pending' 
          AND expires_at > NOW()
          AND id != NEW.id
    ) THEN
        RAISE EXCEPTION 'An active invitation for this email address already exists.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_invitation_email ON public.invitations;
CREATE TRIGGER trg_check_invitation_email
BEFORE INSERT OR UPDATE OF email ON public.invitations
FOR EACH ROW
EXECUTE FUNCTION public.fn_check_invitation_email();

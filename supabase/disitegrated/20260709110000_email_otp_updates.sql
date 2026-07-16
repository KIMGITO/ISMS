-- 20260709110000_email_otp_updates.sql
CREATE TABLE IF NOT EXISTS public.otps (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    type       TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (email, type)
);

ALTER TABLE public.otps ENABLE ROW LEVEL SECURITY;

-- RPC to save or update an OTP code
CREATE OR REPLACE FUNCTION public.save_otp(
    p_email TEXT,
    p_code TEXT,
    p_type TEXT
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.otps (email, code, type, expires_at)
    VALUES (p_email, p_code, p_type, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (email, type) DO UPDATE
    SET code = EXCLUDED.code,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC to verify signup OTP, confirm auth.users email, and mark public.users verified
CREATE OR REPLACE FUNCTION public.verify_signup_otp(
    p_email TEXT,
    p_code TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_success BOOLEAN := FALSE;
BEGIN
    -- Verify code is correct and not expired
    IF EXISTS (
        SELECT 1 FROM public.otps 
        WHERE email = p_email 
          AND code = p_code 
          AND type = 'signup' 
          AND expires_at > NOW()
    ) THEN
        -- Delete the verified OTP code
        DELETE FROM public.otps WHERE email = p_email AND type = 'signup';
        
        -- Mark user as verified in public.users
        UPDATE public.users SET is_verified = TRUE WHERE email = p_email RETURNING id INTO v_user_id;
        
        -- Confirm email in auth.users
        UPDATE auth.users 
        SET email_confirmed_at = NOW(), 
            confirmed_at = NOW(),
            raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('provider', 'email', 'providers', array['email'])
        WHERE email = p_email;
        
        v_success := TRUE;
    END IF;
    
    RETURN v_success;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

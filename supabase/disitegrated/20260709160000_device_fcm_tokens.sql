-- Migration: Create device_fcm_tokens table
-- Description: Stores FCM push notification tokens per device for each user.

CREATE TABLE IF NOT EXISTS public.device_fcm_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    device_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, device_token)
);

-- Enable RLS
ALTER TABLE public.device_fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see their own tokens
CREATE POLICY "Users can view their own tokens" ON public.device_fcm_tokens
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert/update their own tokens
CREATE POLICY "Users can insert their own tokens" ON public.device_fcm_tokens
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tokens" ON public.device_fcm_tokens
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tokens" ON public.device_fcm_tokens
    FOR DELETE
    USING (auth.uid() = user_id);

-- Create a function to automatically update 'updated_at'
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON public.device_fcm_tokens;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.device_fcm_tokens
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Add index on user_id and token
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON public.device_fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON public.device_fcm_tokens(device_token);

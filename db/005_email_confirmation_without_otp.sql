-- Email addresses are required and confirmed by a second entry in the form,
-- but email OTP is no longer required for client registration.
-- Mechanic phone numbers remain verified; shop phones are verified when provided.
-- Run after db/003_contact_verification.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_onboarding(payload JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    m JSONB := payload -> 'mechanic';
    v_sub UUID := (payload ->> 'client_submission_id')::uuid;
BEGIN
    -- Preserve idempotent retries after a successful save.
    IF EXISTS (SELECT 1 FROM mechanics WHERE client_submission_id = v_sub AND captured_by_user = auth.uid()) THEN
        RETURN public.submit_onboarding_unverified(payload);
    END IF;
    IF NOT _consume_contact_verification(v_sub, 'phone', m ->> 'contact_number') THEN
        RAISE EXCEPTION 'PHONE_NOT_VERIFIED: verify the mechanic cell number before saving' USING ERRCODE = 'FS422';
    END IF;
    RETURN public.submit_onboarding_unverified(payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_spares_visit(payload JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    mg JSONB := payload -> 'shop' -> 'manager';
    v_sub UUID := (payload ->> 'client_submission_id')::uuid;
    v_phone TEXT := mg ->> 'contact_number';
BEGIN
    -- Preserve idempotent retries after a successful save.
    IF EXISTS (SELECT 1 FROM spares_visits WHERE client_submission_id = v_sub AND captured_by_user = auth.uid()) THEN
        RETURN public.submit_spares_visit_unverified(payload);
    END IF;
    IF v_phone IS NOT NULL AND NOT _consume_contact_verification(v_sub, 'phone', v_phone) THEN
        RAISE EXCEPTION 'PHONE_NOT_VERIFIED: verify the shop phone before saving' USING ERRCODE = 'FS422';
    END IF;
    RETURN public.submit_spares_visit_unverified(payload);
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';

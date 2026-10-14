-- Contact OTP verification for onboarding submissions.
-- Run after 002_reps_and_rls.sql. API routes write proofs with the service role;
-- submit RPC wrappers consume them atomically before saving client data.

BEGIN;

CREATE TABLE contact_verifications (
    submission_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('email', 'phone')),
    contact TEXT NOT NULL,
    code_hash TEXT,
    attempts SMALLINT NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (submission_id, kind)
);

ALTER TABLE contact_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE contact_verifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE contact_verifications TO service_role;

CREATE OR REPLACE FUNCTION _consume_contact_verification(p_submission_id UUID, p_kind TEXT, p_contact TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id UUID;
BEGIN
    DELETE FROM contact_verifications
     WHERE submission_id = p_submission_id
       AND kind = p_kind
       AND contact = p_contact
       AND verified_at IS NOT NULL
       AND expires_at > now()
     RETURNING submission_id INTO v_id;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION _consume_contact_verification(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Keep the original transaction logic, but make it reachable only through wrappers
-- that first consume the matching, unexpired verification proofs.
ALTER FUNCTION public.submit_onboarding(JSONB) RENAME TO submit_onboarding_unverified;
ALTER FUNCTION public.submit_spares_visit(JSONB) RENAME TO submit_spares_visit_unverified;
REVOKE ALL ON FUNCTION public.submit_onboarding_unverified(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_spares_visit_unverified(JSONB) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.submit_onboarding(payload JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    m JSONB := payload -> 'mechanic';
    v_sub UUID := (payload ->> 'client_submission_id')::uuid;
BEGIN
    -- Preserve the existing idempotent retry behavior after a successful save.
    IF EXISTS (SELECT 1 FROM mechanics WHERE client_submission_id = v_sub AND captured_by_user = auth.uid()) THEN
        RETURN public.submit_onboarding_unverified(payload);
    END IF;
    IF NOT _consume_contact_verification(v_sub, 'email', lower(trim(m ->> 'email'))) THEN
        RAISE EXCEPTION 'EMAIL_NOT_VERIFIED: verify the mechanic email before saving' USING ERRCODE = 'FS422';
    END IF;
    IF NOT _consume_contact_verification(v_sub, 'phone', m ->> 'contact_number') THEN
        RAISE EXCEPTION 'PHONE_NOT_VERIFIED: verify the mechanic cell number before saving' USING ERRCODE = 'FS422';
    END IF;
    RETURN public.submit_onboarding_unverified(payload);
END;
$$;

CREATE FUNCTION public.submit_spares_visit(payload JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    mg JSONB := payload -> 'shop' -> 'manager';
    v_sub UUID := (payload ->> 'client_submission_id')::uuid;
    v_phone TEXT := mg ->> 'contact_number';
BEGIN
    -- Preserve the existing idempotent retry behavior after a successful save.
    IF EXISTS (SELECT 1 FROM spares_visits WHERE client_submission_id = v_sub AND captured_by_user = auth.uid()) THEN
        RETURN public.submit_spares_visit_unverified(payload);
    END IF;
    IF NOT _consume_contact_verification(v_sub, 'email', lower(trim(mg ->> 'email'))) THEN
        RAISE EXCEPTION 'EMAIL_NOT_VERIFIED: verify the manager email before saving' USING ERRCODE = 'FS422';
    END IF;
    IF v_phone IS NOT NULL AND NOT _consume_contact_verification(v_sub, 'phone', v_phone) THEN
        RAISE EXCEPTION 'PHONE_NOT_VERIFIED: verify the shop phone before saving' USING ERRCODE = 'FS422';
    END IF;
    RETURN public.submit_spares_visit_unverified(payload);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_onboarding(JSONB), public.submit_spares_visit(JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_onboarding(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_spares_visit(JSONB) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

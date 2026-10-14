-- Run after 002_reps_and_rls.sql (and 003_contact_verification.sql if used).
-- The contact-verification API validates the rep session, then reads profiles
-- with a service-role client. This grant is safe to re-run.
GRANT SELECT ON TABLE public.profiles TO service_role;

-- ============================================================================
-- DEV ONLY. A minimal stand-in for what Supabase already provides, so the
-- migrations can be tested on a plain Postgres. Never run this on Supabase.
--   roles anon / authenticated, the auth.users table, and auth.uid() which
--   reads the user id from the request.jwt.claim.sub setting (as Supabase does).
-- ============================================================================
CREATE ROLE anon          NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role  NOLOGIN BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA auth;

CREATE TABLE auth.users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email              TEXT UNIQUE,
    raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA public, extensions, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

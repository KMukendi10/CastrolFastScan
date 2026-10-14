-- ============================================================================
-- FastScan field database: migration 002
--   Rep logins, automatic attribution, Row Level Security, submit functions,
--   and the dashboard views for per-rep performance.
--
-- Run AFTER 001_schema.sql, in the Supabase SQL Editor.
--
-- What this does
--   1. profiles: one row per login (rep or manager), created automatically
--      when you add a user in Supabase Auth.
--   2. captured_by_user on every captured record, stamped by the database from
--      the logged-in user. The old text captured_by becomes captured_by_legacy.
--   3. Row Level Security: a rep sees and edits only their own captures; a
--      manager sees everything. Nobody can insert or delete rows directly
--      through the API; captures go through submit_onboarding() and
--      submit_spares_visit(), which save everything in one transaction.
--   4. Views switched to security_invoker so they obey those rules.
--   5. v_rep_performance and v_captures_daily for the dashboard.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Profiles
-- ----------------------------------------------------------------------------
CREATE TYPE app_role AS ENUM ('rep', 'manager');

CREATE TABLE profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    full_name   VARCHAR(120) NOT NULL,
    role        app_role     NOT NULL DEFAULT 'rep',
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A profile is created automatically when a user is added in Supabase Auth.
-- Everyone starts as a rep. Promote a manager with:
--   UPDATE profiles SET role = 'manager' WHERE id = (SELECT id FROM auth.users WHERE email = '...');
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO profiles (id, full_name)
    VALUES (NEW.id,
            COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
                     split_part(NEW.email, '@', 1)));
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Users that already exist (for example the account you signed up with before
-- running this) get a profile too. Safe to re-run.
INSERT INTO profiles (id, full_name)
SELECT u.id,
       COALESCE(NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1))
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Who is calling? These read profiles without tripping profiles' own RLS.
-- Inactive users get NULL, which every policy treats as "no access".
CREATE OR REPLACE FUNCTION current_app_role() RETURNS app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT role FROM profiles WHERE id = auth.uid() AND active
$$;

CREATE OR REPLACE FUNCTION is_manager() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE((SELECT role = 'manager' FROM profiles WHERE id = auth.uid() AND active), FALSE)
$$;

-- Can the caller see/edit a row owned by this user?
CREATE OR REPLACE FUNCTION can_access(owner UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE current_app_role()
               WHEN 'manager' THEN TRUE
               WHEN 'rep'     THEN owner IS NOT NULL AND owner = auth.uid()
               ELSE FALSE
           END
$$;

-- ----------------------------------------------------------------------------
-- 2. Attribution columns
--    DEFAULT auth.uid() means a plain insert by a logged-in user is stamped
--    automatically. Legacy imported rows keep NULL.
-- ----------------------------------------------------------------------------
ALTER TABLE mechanics   RENAME COLUMN captured_by TO captured_by_legacy;
ALTER TABLE spares_shops  RENAME COLUMN captured_by TO captured_by_legacy;
ALTER TABLE spares_visits RENAME COLUMN captured_by TO captured_by_legacy;
ALTER TABLE consent_log   RENAME COLUMN captured_by TO captured_by_legacy;

ALTER TABLE workshops     ADD COLUMN captured_by_user UUID REFERENCES profiles (id) DEFAULT auth.uid();
ALTER TABLE mechanics     ADD COLUMN captured_by_user UUID REFERENCES profiles (id) DEFAULT auth.uid();
ALTER TABLE spares_shops  ADD COLUMN captured_by_user UUID REFERENCES profiles (id) DEFAULT auth.uid();
ALTER TABLE spares_visits ADD COLUMN captured_by_user UUID REFERENCES profiles (id) DEFAULT auth.uid();
ALTER TABLE consent_log   ADD COLUMN captured_by_user UUID REFERENCES profiles (id) DEFAULT auth.uid();

-- Device-generated id so a retry after a dropped connection never duplicates.
ALTER TABLE mechanics     ADD COLUMN client_submission_id UUID UNIQUE;
ALTER TABLE spares_visits ADD COLUMN client_submission_id UUID UNIQUE;

CREATE INDEX idx_workshops_owner     ON workshops (captured_by_user);
CREATE INDEX idx_mechanics_owner     ON mechanics (captured_by_user, created_at DESC);
CREATE INDEX idx_spares_shops_owner  ON spares_shops (captured_by_user, created_at DESC);
CREATE INDEX idx_spares_visits_owner ON spares_visits (captured_by_user, created_at DESC);

-- Only a manager may move a record to a different rep.
CREATE OR REPLACE FUNCTION prevent_owner_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.captured_by_user IS DISTINCT FROM OLD.captured_by_user AND NOT is_manager() THEN
        RAISE EXCEPTION 'only a manager can reassign a record' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workshops_owner     BEFORE UPDATE ON workshops     FOR EACH ROW EXECUTE FUNCTION prevent_owner_change();
CREATE TRIGGER trg_mechanics_owner     BEFORE UPDATE ON mechanics     FOR EACH ROW EXECUTE FUNCTION prevent_owner_change();
CREATE TRIGGER trg_spares_shops_owner  BEFORE UPDATE ON spares_shops  FOR EACH ROW EXECUTE FUNCTION prevent_owner_change();
CREATE TRIGGER trg_spares_visits_owner BEFORE UPDATE ON spares_visits FOR EACH ROW EXECUTE FUNCTION prevent_owner_change();

-- ----------------------------------------------------------------------------
-- 3. Views that referenced the old text column: drop and rebuild
-- ----------------------------------------------------------------------------
DROP VIEW v_scan_data_gaps;
DROP VIEW v_mechanics_profile;
DROP VIEW v_independent_mechanics;
DROP VIEW v_mechanic_flat;
DROP VIEW v_spares_latest;

CREATE VIEW v_mechanic_flat WITH (security_invoker = true) AS
SELECT
    m.mechanic_id,
    m.captured_by_user,
    m.database_kind,
    m.capture_date                              AS "Date",
    COALESCE(pr.full_name, m.captured_by_legacy) AS "Captured by",
    m.mechanic_email                            AS "Mechanic ID (Email Address)",
    m.first_name                                AS "First name",
    m.surname                                   AS "Surname",
    m.contact_number                            AS "Contact number",
    m.alternative_contact                       AS "Alternative contact",
    m.whatsapp_number                           AS "Whatsapp number",
    m.preferred_language                        AS "Preferred language",
    tb.name                                     AS "Training background",
    round(m.experience_months / 12.0, 1)        AS "Years of experience",
    (SELECT string_agg(s.name, ', ' ORDER BY s.name)
       FROM mechanic_specialisations ms
       JOIN specialisations s USING (specialisation_id)
      WHERE ms.mechanic_id = m.mechanic_id)     AS "Specialisation",
    w.workshop_name                             AS "Workshop name",
    bt.name                                     AS "Business type",
    r.name                                      AS "Region",
    w.town_suburb                               AS "Town/Suburb",
    w.street_address                            AS "Street address",
    ST_Y(w.gps_location::geometry)              AS "GPS latitude",
    ST_X(w.gps_location::geometry)              AS "GPS longitude",
    w.vehicles_per_day                          AS "Vehicles per day",
    m.pays_rent                                 AS "Pays rent?",
    p.main_oil_brand                            AS "Main oil brand used",
    p.reason_for_brand                          AS "Reason for brand",
    sc.name                                     AS "Stock bought",
    p.supplier_shop_name                        AS "Shop name",
    f.is_fastscan_registered                    AS "FastScan registered",
    f.registration_date                         AS "Registration date",
    f.first_scan_completed                      AS "First scan completed (agent)",
    f.total_scans                               AS "Total scans",
    f.last_interaction_date                     AS "Last interaction",
    nr.name                                     AS "Reason not scanning",
    f.fastscan_notes                            AS "FastScan notes",
    f.service_kit_distributed                   AS "Service kit distributed",
    f.kit_items_given                           AS "Items given",
    f.incentive_distributed                     AS "Incentive distributed",
    COALESCE(c.consent_given, FALSE)            AS "POPIA consent",
    w.branding_requested                        AS "Branding requested",
    m.notes                                     AS "Notes"
FROM mechanics m
JOIN workshops w                        ON w.workshop_id = m.workshop_id
JOIN business_types bt                  ON bt.business_type_id = w.business_type_id
JOIN regions r                          ON r.region_id = w.region_id
LEFT JOIN profiles pr                   ON pr.id = m.captured_by_user
LEFT JOIN training_backgrounds tb       ON tb.training_background_id = m.training_background_id
LEFT JOIN workshop_supply_preferences p ON p.workshop_id = w.workshop_id
LEFT JOIN supply_channels sc            ON sc.supply_channel_id = p.supply_channel_id
LEFT JOIN fastscan_status f             ON f.mechanic_id = m.mechanic_id
LEFT JOIN not_scanning_reasons nr       ON nr.reason_id = f.not_scanning_reason_id
LEFT JOIN v_current_consent c           ON c.mechanic_id = m.mechanic_id
                                       AND c.purpose = 'fastscan_activation';

CREATE VIEW v_mechanics_profile WITH (security_invoker = true) AS
    SELECT * FROM v_mechanic_flat WHERE database_kind = 'mechanics_profile';
CREATE VIEW v_independent_mechanics WITH (security_invoker = true) AS
    SELECT * FROM v_mechanic_flat WHERE database_kind = 'independent_mechanic';

CREATE VIEW v_spares_latest WITH (security_invoker = true) AS
SELECT
    s.shop_id,
    s.captured_by_user,
    v.visit_date                                AS "Date of latest visit",
    r.name                                      AS "Region",
    s.area                                      AS "Area",
    s.trading_name                              AS "Spare shop trading name",
    st.name                                     AS "Business type",
    s.years_in_operation                        AS "Years in operation",
    s.address                                   AS "Address",
    ST_Y(s.gps_location::geometry)              AS "GPS latitude",
    ST_X(s.gps_location::geometry)              AS "GPS longitude",
    s.manager_first_name                        AS "Manager name",
    s.manager_surname                           AS "Manager surname",
    s.manager_email                             AS "Manager email",
    s.contact_number                            AS "Contact number",
    s.whatsapp_number                           AS "Whatsapp number",
    v.stocks_castrol                            AS "Stocks Castrol?",
    (SELECT string_agg(pl.name, ', ' ORDER BY pl.name)
       FROM spares_visit_products vp JOIN castrol_product_lines pl USING (product_line_id)
      WHERE vp.visit_id = v.visit_id)           AS "Castrol products stocked",
    v.castrol_stock_level                       AS "Castrol stock level",
    v.branding_visibility                       AS "Castrol branding visibility",
    (SELECT jsonb_object_agg(k.label, vpr.price_zar ORDER BY k.sku_id)
       FROM spares_visit_prices vpr JOIN castrol_skus k USING (sku_id)
      WHERE vpr.visit_id = v.visit_id)          AS "Prices (ZAR)",
    (SELECT string_agg(cb.name, ', ' ORDER BY cb.name)
       FROM spares_visit_competitors vc JOIN competitor_brands cb USING (brand_id)
      WHERE vc.visit_id = v.visit_id)           AS "Competitor brands stocked",
    v.strongest_sellers                         AS "Strongest sellers",
    v.most_customer_requests                    AS "Most customer requests",
    v.most_mechanic_requests                    AS "Most mechanic requests",
    v.serves_mechanics                          AS "Serves mechanics?",
    v.mechanics_visiting_weekly                 AS "Mechanics visiting weekly",
    v.can_refer_workshops                       AS "Can refer workshops?",
    v.promo_sales_to_date                       AS "Promo sales to date",
    v.competitor_price_comparison               AS "Competitor price comparison",
    v.new_stock_received                        AS "New stock",
    v.notes                                     AS "Notes",
    COALESCE(pr.full_name, s.captured_by_legacy) AS "Captured by"
FROM spares_shops s
JOIN regions r ON r.region_id = s.region_id
LEFT JOIN profiles pr ON pr.id = s.captured_by_user
LEFT JOIN shop_types st ON st.shop_type_id = s.shop_type_id
LEFT JOIN LATERAL (
    SELECT * FROM spares_visits sv
     WHERE sv.shop_id = s.shop_id
     ORDER BY sv.visit_date DESC, sv.visit_id DESC
     LIMIT 1
) v ON TRUE;

CREATE VIEW v_scan_data_gaps WITH (security_invoker = true) AS
SELECT m.mechanic_id, m.mechanic_email, m.database_kind, m.captured_by_user,
       f.first_scan_completed, f.total_scans
FROM mechanics m
JOIN fastscan_status f ON f.mechanic_id = m.mechanic_id
WHERE f.first_scan_completed AND f.total_scans = 0;

-- The views from 001 that survive: make them obey the caller's access rules.
ALTER VIEW v_current_consent        SET (security_invoker = true);
ALTER VIEW v_contactable_mechanics  SET (security_invoker = true);
ALTER VIEW v_adoption_summary       SET (security_invoker = true);
ALTER VIEW v_not_scanning_reasons   SET (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 4. Dashboard views (security_invoker: a rep sees their own numbers, a manager
--    sees every rep)
-- ----------------------------------------------------------------------------
CREATE VIEW v_rep_performance WITH (security_invoker = true) AS
WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
mech AS (
    SELECT m.captured_by_user AS rep_id,
           count(*)                                                       AS mechanics_captured,
           count(*) FILTER (WHERE m.database_kind = 'mechanics_profile')  AS profiles_captured,
           count(*) FILTER (WHERE m.database_kind = 'independent_mechanic') AS independents_captured,
           count(*) FILTER (WHERE f.is_fastscan_registered)               AS registered,
           count(*) FILTER (WHERE f.total_scans > 0)                      AS adopters,
           COALESCE(sum(f.total_scans), 0)                                AS total_scans,
           count(*) FILTER (WHERE f.service_kit_distributed)              AS kits_distributed,
           count(*) FILTER (WHERE f.incentive_distributed)                AS incentives_distributed,
           count(*) FILTER (WHERE c.consent_given)                        AS consent_given,
           max(m.created_at)                                              AS last_mechanic_at
    FROM mechanics m
    LEFT JOIN fastscan_status f ON f.mechanic_id = m.mechanic_id
    LEFT JOIN v_current_consent c ON c.mechanic_id = m.mechanic_id AND c.purpose = 'fastscan_activation'
    GROUP BY m.captured_by_user
),
shops AS (
    SELECT s.captured_by_user AS rep_id,
           count(*)           AS shops_captured,
           max(s.created_at)  AS last_shop_at
    FROM spares_shops s
    GROUP BY s.captured_by_user
),
visits AS (
    SELECT captured_by_user AS rep_id, count(*) AS shop_visits
    FROM spares_visits GROUP BY captured_by_user
),
recent AS (
    SELECT rep_id,
           count(*) FILTER (WHERE d = (SELECT d FROM today))      AS captured_today,
           count(*) FILTER (WHERE d >= (SELECT d FROM today) - 6) AS captured_7d,
           count(*) FILTER (WHERE d >= (SELECT d FROM today) - 29) AS captured_30d
    FROM (
        -- capture_date (the day it was captured), not created_at (the day it synced)
        SELECT captured_by_user AS rep_id, capture_date AS d FROM mechanics
        UNION ALL
        SELECT captured_by_user, capture_date FROM spares_shops
    ) x
    GROUP BY rep_id
)
SELECT
    p.id                                              AS rep_id,
    p.full_name                                       AS rep_name,
    p.role,
    p.active,
    COALESCE(mech.mechanics_captured, 0)              AS mechanics_captured,
    COALESCE(mech.profiles_captured, 0)               AS profiles_captured,
    COALESCE(mech.independents_captured, 0)           AS independents_captured,
    COALESCE(shops.shops_captured, 0)                 AS shops_captured,
    COALESCE(mech.mechanics_captured, 0) + COALESCE(shops.shops_captured, 0) AS people_captured,
    COALESCE(visits.shop_visits, 0)                   AS shop_visits,
    COALESCE(recent.captured_today, 0)                AS captured_today,
    COALESCE(recent.captured_7d, 0)                   AS captured_7d,
    COALESCE(recent.captured_30d, 0)                  AS captured_30d,
    COALESCE(mech.registered, 0)                      AS registered,
    COALESCE(mech.adopters, 0)                        AS adopters,
    COALESCE(mech.total_scans, 0)                     AS total_scans,
    COALESCE(mech.kits_distributed, 0)                AS kits_distributed,
    COALESCE(mech.incentives_distributed, 0)          AS incentives_distributed,
    round(100.0 * COALESCE(mech.consent_given, 0)
          / NULLIF(mech.mechanics_captured, 0), 1)    AS consent_rate_pct,
    round(100.0 * COALESCE(mech.adopters, 0)
          / NULLIF(mech.mechanics_captured, 0), 1)    AS adoption_pct,
    GREATEST(mech.last_mechanic_at, shops.last_shop_at) AS last_capture_at
FROM profiles p
LEFT JOIN mech   ON mech.rep_id   = p.id
LEFT JOIN shops  ON shops.rep_id  = p.id
LEFT JOIN visits ON visits.rep_id = p.id
LEFT JOIN recent ON recent.rep_id = p.id;

-- One row per rep per day per database, for the trend chart
CREATE VIEW v_captures_daily WITH (security_invoker = true) AS
SELECT captured_by_user AS rep_id,
       capture_date AS day,
       database_kind::text AS database,
       count(*) AS captures
FROM mechanics
GROUP BY 1, 2, 3
UNION ALL
SELECT captured_by_user,
       capture_date,
       'spares',
       count(*)
FROM spares_shops
GROUP BY 1, 2;

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------
-- Start from nothing, then grant exactly what the app needs. Supabase grants
-- new tables to anon and authenticated by default, so strip that from our own
-- tables, views and sequences (not from objects an extension owns, such as
-- PostGIS's spatial_ref_sys).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    LOOP
        IF r.relkind = 'S' THEN
            EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon, authenticated', r.relname);
        ELSE
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', r.relname);
        END IF;
    END LOOP;
END $$;

-- Future objects we create in public are closed by default too (add grants on purpose).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Captured data: read for everyone logged in (RLS narrows it), update only the
-- safe columns below. No INSERT or DELETE through the API.
GRANT SELECT         ON mechanics, workshops, workshop_supply_preferences, mechanic_specialisations,
                        fastscan_status, consent_log, spares_shops, spares_visits,
                        spares_visit_products, spares_visit_competitors, spares_visit_prices,
                        profiles                                            TO authenticated;
-- Server API routes use the service-role client to resolve the caller's rep profile.
GRANT SELECT ON profiles TO service_role;
-- UPDATE is column by column. Reps may correct the descriptive fields of their
-- own records, but never: the owner of a row (only a manager, enforced by the
-- prevent_owner_change trigger), which parent row it hangs off, the capture
-- date, the unique email, the submission id, or anything in fastscan_status.
-- Registration and scan counts change only through update_fastscan_status(),
-- which checks consent. Tables not listed here (fastscan_status, consent_log)
-- have no UPDATE grant at all.
GRANT UPDATE (first_name, surname, contact_number, alternative_contact, whatsapp_number,
              preferred_language, experience_months, training_background_id, pays_rent, notes,
              captured_by_user)                              ON mechanics TO authenticated;
GRANT UPDATE (workshop_name, business_type_id, region_id, town_suburb, street_address, gps_location,
              vehicles_per_day, branding_requested, branding_notes,
              captured_by_user)                              ON workshops TO authenticated;
GRANT UPDATE (main_oil_brand, reason_for_brand, supply_channel_id, supplier_shop_name)
                                                             ON workshop_supply_preferences TO authenticated;
GRANT UPDATE (trading_name, shop_type_id, region_id, area, address, gps_location, years_in_operation,
              manager_first_name, manager_surname, contact_number, whatsapp_number,
              captured_by_user)                              ON spares_shops TO authenticated;
GRANT UPDATE (visit_date, stocks_castrol, castrol_stock_level, branding_visibility, strongest_sellers,
              most_customer_requests, most_mechanic_requests, serves_mechanics,
              mechanics_visiting_weekly, can_refer_workshops, promo_sales_to_date,
              competitor_price_comparison, new_stock_received, notes,
              captured_by_user)                              ON spares_visits TO authenticated;
GRANT UPDATE (full_name, role, active) ON profiles                          TO authenticated;

ALTER TABLE profiles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshops                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanics                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanic_specialisations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_supply_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE fastscan_status             ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE spares_shops                ENABLE ROW LEVEL SECURITY;
ALTER TABLE spares_visits               ENABLE ROW LEVEL SECURITY;
ALTER TABLE spares_visit_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE spares_visit_competitors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE spares_visit_prices         ENABLE ROW LEVEL SECURITY;

-- profiles: you see yourself; a manager sees and manages everyone
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
    USING (id = auth.uid() OR is_manager());
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
    USING (is_manager()) WITH CHECK (is_manager());

-- parent tables: owner or manager
CREATE POLICY workshops_select ON workshops FOR SELECT TO authenticated USING (can_access(captured_by_user));
CREATE POLICY workshops_update ON workshops FOR UPDATE TO authenticated
    USING (can_access(captured_by_user)) WITH CHECK (can_access(captured_by_user));

CREATE POLICY mechanics_select ON mechanics FOR SELECT TO authenticated USING (can_access(captured_by_user));
CREATE POLICY mechanics_update ON mechanics FOR UPDATE TO authenticated
    USING (can_access(captured_by_user)) WITH CHECK (can_access(captured_by_user));

CREATE POLICY spares_shops_select ON spares_shops FOR SELECT TO authenticated USING (can_access(captured_by_user));
CREATE POLICY spares_shops_update ON spares_shops FOR UPDATE TO authenticated
    USING (can_access(captured_by_user)) WITH CHECK (can_access(captured_by_user));

CREATE POLICY spares_visits_select ON spares_visits FOR SELECT TO authenticated USING (can_access(captured_by_user));
CREATE POLICY spares_visits_update ON spares_visits FOR UPDATE TO authenticated
    USING (can_access(captured_by_user)) WITH CHECK (can_access(captured_by_user));

-- child tables: allowed when the parent row is visible to the caller. The
-- subquery runs under the caller's own RLS, so it only matches parents they
-- may see.
CREATE POLICY mech_spec_select ON mechanic_specialisations FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM mechanics m WHERE m.mechanic_id = mechanic_specialisations.mechanic_id));

CREATE POLICY supply_select ON workshop_supply_preferences FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM workshops w WHERE w.workshop_id = workshop_supply_preferences.workshop_id));
CREATE POLICY supply_update ON workshop_supply_preferences FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM workshops w WHERE w.workshop_id = workshop_supply_preferences.workshop_id))
    WITH CHECK (EXISTS (SELECT 1 FROM workshops w WHERE w.workshop_id = workshop_supply_preferences.workshop_id));

CREATE POLICY fastscan_select ON fastscan_status FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM mechanics m WHERE m.mechanic_id = fastscan_status.mechanic_id));

CREATE POLICY consent_select ON consent_log FOR SELECT TO authenticated
    USING (   (mechanic_id IS NOT NULL AND EXISTS (SELECT 1 FROM mechanics m WHERE m.mechanic_id = consent_log.mechanic_id))
           OR (shop_id     IS NOT NULL AND EXISTS (SELECT 1 FROM spares_shops s WHERE s.shop_id = consent_log.shop_id)));

CREATE POLICY visit_products_select ON spares_visit_products FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM spares_visits v WHERE v.visit_id = spares_visit_products.visit_id));
CREATE POLICY visit_competitors_select ON spares_visit_competitors FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM spares_visits v WHERE v.visit_id = spares_visit_competitors.visit_id));
CREATE POLICY visit_prices_select ON spares_visit_prices FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM spares_visits v WHERE v.visit_id = spares_visit_prices.visit_id));

-- lookup tables: everyone logged in reads (they feed the dropdowns); managers extend them
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['regions','business_types','training_backgrounds','specialisations',
                             'supply_channels','not_scanning_reasons','shop_types',
                             'castrol_product_lines','castrol_skus','competitor_brands']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
        EXECUTE format('GRANT INSERT, UPDATE ON %I TO authenticated', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (current_app_role() IS NOT NULL)',
                       t || '_select', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (is_manager())',
                       t || '_insert', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (is_manager()) WITH CHECK (is_manager())',
                       t || '_update', t);
    END LOOP;
END $$;

-- Sequences: lookups use identity columns, managers inserting need them
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Views
GRANT SELECT ON v_mechanic_flat, v_mechanics_profile, v_independent_mechanics, v_spares_latest,
                v_current_consent, v_contactable_mechanics, v_adoption_summary,
                v_not_scanning_reasons, v_scan_data_gaps, v_rep_performance, v_captures_daily
    TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Submit functions (the only way to create records through the API)
-- ----------------------------------------------------------------------------

-- Internal: name -> id for a lookup table. Table and column names come from
-- literals in this file only; never expose this to the API.
-- (castrol_skus stores its text in a column called "label", every other lookup
-- uses "name", hence p_name_col.)
CREATE OR REPLACE FUNCTION _lookup_id(p_table TEXT, p_id_col TEXT, p_name TEXT, p_label TEXT,
                                      p_name_col TEXT DEFAULT 'name')
RETURNS SMALLINT
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE r SMALLINT;
BEGIN
    IF p_name IS NULL THEN RETURN NULL; END IF;
    EXECUTE format('SELECT %I FROM %I WHERE %I = $1', p_id_col, p_table, p_name_col) INTO r USING p_name;
    IF r IS NULL THEN
        RAISE EXCEPTION 'unknown % "%"', p_label, p_name USING ERRCODE = '22023';
    END IF;
    RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION _gps_point(p JSONB) RETURNS geography
LANGUAGE sql IMMUTABLE SET search_path = public, extensions, pg_temp AS $$
    SELECT CASE WHEN p IS NULL OR p ->> 'latitude' IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint((p ->> 'longitude')::float8,
                                             (p ->> 'latitude')::float8), 4326)::geography
           END
$$;

-- Capture day in South African time. The device clock decides it (an offline
-- capture synced next day still counts on the day it happened), but a clock
-- set in the future is clamped to now.
-- A device-supplied timestamp, forced into [now - 30 days, now]. That also
-- neutralises 'infinity' / '-infinity', which would otherwise poison ordering.
CREATE OR REPLACE FUNCTION _clamp_ts(ts TEXT) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
    SELECT GREATEST(LEAST(COALESCE(ts::timestamptz, now()), now()), now() - interval '30 days')
$$;

CREATE OR REPLACE FUNCTION _sast_date(ts TEXT) RETURNS DATE
LANGUAGE sql STABLE AS $$
    SELECT (_clamp_ts(ts) AT TIME ZONE 'Africa/Johannesburg')::date
$$;

-- submit_onboarding: a Mechanics Profile or Independent Mechanic capture.
-- Payload shape = payloads/onboarding.schema.json (mechanicSubmission).
-- The rep is NOT in the payload: it is taken from the login.
CREATE OR REPLACE FUNCTION submit_onboarding(payload JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    uid       UUID := auth.uid();
    v_sub     UUID := (payload ->> 'client_submission_id')::uuid;
    v_kind    database_kind_enum := (payload ->> 'database')::database_kind_enum;
    m         JSONB := payload -> 'mechanic';
    w         JSONB := payload -> 'workshop';
    sp        JSONB := payload -> 'supply_preferences';
    fs        JSONB := payload -> 'fastscan_status';
    c         JSONB := payload -> 'consent';
    v_date    DATE  := _sast_date(payload ->> 'captured_at');
    v_ws      BIGINT;
    v_mech    BIGINT;
    v_owner   UUID;
    v_reg     BOOLEAN;
    v_spec    TEXT;
    v_cn      TEXT;
BEGIN
    IF uid IS NULL OR current_app_role() IS NULL THEN
        RAISE EXCEPTION 'not signed in, or account is inactive' USING ERRCODE = '42501';
    END IF;
    IF pg_column_size(payload) > 200000 THEN
        RAISE EXCEPTION 'payload too large' USING ERRCODE = '22023';
    END IF;
    IF v_sub IS NULL OR v_kind IS NULL OR m IS NULL OR w IS NULL OR c IS NULL THEN
        RAISE EXCEPTION 'payload is missing client_submission_id, database, mechanic, workshop or consent'
              USING ERRCODE = '22023';
    END IF;

    -- one submission at a time per client_submission_id
    PERFORM pg_advisory_xact_lock(hashtextextended(v_sub::text, 0));

    SELECT mechanic_id, captured_by_user INTO v_mech, v_owner
      FROM mechanics WHERE client_submission_id = v_sub;
    IF FOUND THEN
        IF v_owner IS DISTINCT FROM uid THEN
            RAISE EXCEPTION 'submission id already used' USING ERRCODE = '42501';
        END IF;
        RETURN jsonb_build_object('mechanic_id', v_mech, 'duplicate', TRUE);
    END IF;

    v_reg := COALESCE((fs ->> 'is_registered')::boolean, FALSE);
    IF v_reg AND NOT COALESCE((c ->> 'given')::boolean, FALSE) THEN
        RAISE EXCEPTION 'CONSENT_REQUIRED: cannot register for FastScan without POPIA consent'
              USING ERRCODE = 'FS422';
    END IF;

    INSERT INTO workshops (workshop_name, business_type_id, region_id, town_suburb, street_address,
                           gps_location, vehicles_per_day, branding_requested, branding_notes,
                           captured_by_user)
    VALUES (w ->> 'name',
            _lookup_id('business_types', 'business_type_id', w ->> 'business_type', 'business_type'),
            _lookup_id('regions', 'region_id', w ->> 'region', 'region'),
            w ->> 'town_suburb', w ->> 'street_address',
            _gps_point(w -> 'gps'),
            (w ->> 'vehicles_per_day')::vehicles_band_enum,
            COALESCE((w ->> 'branding_requested')::boolean, FALSE),
            w ->> 'branding_notes',
            uid)
    RETURNING workshop_id INTO v_ws;

    BEGIN
        INSERT INTO mechanics (mechanic_email, database_kind, workshop_id, first_name, surname,
                               contact_number, alternative_contact, whatsapp_number, preferred_language,
                               experience_months, training_background_id, pays_rent, notes,
                               capture_date, captured_by_user, client_submission_id)
        VALUES (m ->> 'email', v_kind, v_ws, m ->> 'first_name', m ->> 'surname',
                m ->> 'contact_number', m ->> 'alternative_contact', m ->> 'whatsapp_number',
                (m ->> 'preferred_language')::language_enum,
                CASE WHEN m ->> 'experience_years' IS NULL THEN NULL
                     ELSE round((m ->> 'experience_years')::numeric * 12)::smallint END,
                _lookup_id('training_backgrounds', 'training_background_id', m ->> 'training_background', 'training_background'),
                (m ->> 'pays_rent')::boolean,
                m ->> 'notes',
                v_date, uid, v_sub)
        RETURNING mechanic_id INTO v_mech;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
        IF v_cn = 'mechanics_mechanic_email_key' THEN
            RAISE EXCEPTION 'DUPLICATE_EMAIL: a mechanic with this email is already captured'
                  USING ERRCODE = 'FS409';
        END IF;
        RAISE;
    END;

    FOR v_spec IN SELECT jsonb_array_elements_text(COALESCE(m -> 'specialisations', '[]'::jsonb)) LOOP
        INSERT INTO mechanic_specialisations (mechanic_id, specialisation_id)
        VALUES (v_mech, _lookup_id('specialisations', 'specialisation_id', v_spec, 'specialisation'))
        ON CONFLICT DO NOTHING;
    END LOOP;

    IF sp IS NOT NULL THEN
        INSERT INTO workshop_supply_preferences (workshop_id, main_oil_brand, reason_for_brand,
                                                 supply_channel_id, supplier_shop_name)
        VALUES (v_ws, sp ->> 'main_oil_brand', sp ->> 'reason_for_brand',
                _lookup_id('supply_channels', 'supply_channel_id', sp ->> 'supply_channel', 'supply_channel'),
                sp ->> 'supplier_shop_name');
    END IF;

    INSERT INTO fastscan_status (mechanic_id, is_fastscan_registered, registration_date,
                                 first_scan_completed, total_scans, last_interaction_date,
                                 service_kit_distributed, kit_items_given, incentive_distributed,
                                 not_scanning_reason_id, fastscan_notes)
    VALUES (v_mech, v_reg, (fs ->> 'registration_date')::date,
            COALESCE((fs ->> 'first_scan_completed')::boolean, FALSE),
            COALESCE((fs ->> 'total_scans')::int, 0),
            COALESCE((fs ->> 'last_interaction_date')::date, v_date),
            (fs ->> 'service_kit_distributed')::boolean, fs ->> 'kit_items_given',
            (fs ->> 'incentive_distributed')::boolean,
            _lookup_id('not_scanning_reasons', 'reason_id', fs ->> 'not_scanning_reason', 'not_scanning_reason'),
            fs ->> 'notes');

    INSERT INTO consent_log (mechanic_id, consent_given, consent_method, consent_text_version,
                             evidence_ref, captured_by_user, recorded_at)
    VALUES (v_mech, (c ->> 'given')::boolean, (c ->> 'method')::consent_method_enum,
            c ->> 'text_version', c ->> 'evidence_ref', uid,
            _clamp_ts(c ->> 'recorded_at'));

    RETURN jsonb_build_object('mechanic_id', v_mech, 'workshop_id', v_ws, 'duplicate', FALSE);
END;
$$;

-- submit_spares_visit: a Spares shop audit. Finds the shop by manager email or
-- creates it, then records the visit, products, competitors and prices.
-- Payload shape = payloads/onboarding.schema.json (sparesSubmission).
CREATE OR REPLACE FUNCTION submit_spares_visit(payload JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    uid     UUID := auth.uid();
    v_sub   UUID := (payload ->> 'client_submission_id')::uuid;
    s       JSONB := payload -> 'shop';
    mg      JSONB := payload -> 'shop' -> 'manager';
    v       JSONB := payload -> 'visit';
    c       JSONB := payload -> 'consent';
    v_shop  BIGINT;
    v_owner UUID;
    v_visit BIGINT;
    v_new   BOOLEAN := FALSE;
    v_item  TEXT;
    v_price RECORD;
    v_last  BOOLEAN;
BEGIN
    IF uid IS NULL OR current_app_role() IS NULL THEN
        RAISE EXCEPTION 'not signed in, or account is inactive' USING ERRCODE = '42501';
    END IF;
    IF pg_column_size(payload) > 200000 THEN
        RAISE EXCEPTION 'payload too large' USING ERRCODE = '22023';
    END IF;
    IF v_sub IS NULL OR s IS NULL OR mg IS NULL OR v IS NULL OR c IS NULL THEN
        RAISE EXCEPTION 'payload is missing client_submission_id, shop, visit or consent' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_sub::text, 0));

    SELECT visit_id, shop_id, captured_by_user INTO v_visit, v_shop, v_owner
      FROM spares_visits WHERE client_submission_id = v_sub;
    IF FOUND THEN
        IF v_owner IS DISTINCT FROM uid THEN
            RAISE EXCEPTION 'submission id already used' USING ERRCODE = '42501';
        END IF;
        RETURN jsonb_build_object('shop_id', v_shop, 'visit_id', v_visit, 'duplicate', TRUE);
    END IF;

    SELECT shop_id, captured_by_user INTO v_shop, v_owner
      FROM spares_shops WHERE manager_email = (mg ->> 'email')::citext;   -- explicit cast keeps it case-insensitive
    IF FOUND THEN
        IF v_owner IS DISTINCT FROM uid AND NOT is_manager() THEN
            RAISE EXCEPTION 'SHOP_EXISTS: this shop was captured by another rep; ask your manager'
                  USING ERRCODE = 'FS409';
        END IF;
    ELSE
        INSERT INTO spares_shops (trading_name, shop_type_id, region_id, area, address, gps_location,
                                  years_in_operation, manager_first_name, manager_surname, manager_email,
                                  contact_number, whatsapp_number, capture_date, captured_by_user)
        VALUES (s ->> 'trading_name',
                _lookup_id('shop_types', 'shop_type_id', s ->> 'shop_type', 'shop_type'),
                _lookup_id('regions', 'region_id', s ->> 'region', 'region'),
                s ->> 'area', s ->> 'address', _gps_point(s -> 'gps'),
                (s ->> 'years_in_operation')::years_in_operation_enum,
                mg ->> 'first_name', mg ->> 'surname', mg ->> 'email',
                mg ->> 'contact_number', mg ->> 'whatsapp_number',
                _sast_date(payload ->> 'captured_at'), uid)
        RETURNING shop_id INTO v_shop;
        v_new := TRUE;
    END IF;

    INSERT INTO spares_visits (shop_id, visit_date, stocks_castrol, castrol_stock_level, branding_visibility,
                               strongest_sellers, most_customer_requests, most_mechanic_requests,
                               serves_mechanics, mechanics_visiting_weekly, can_refer_workshops,
                               promo_sales_to_date, competitor_price_comparison, new_stock_received,
                               notes, captured_by_user, client_submission_id)
    VALUES (v_shop, (v ->> 'visit_date')::date, (v ->> 'stocks_castrol')::boolean,
            (v ->> 'castrol_stock_level')::stock_level_enum,
            (v ->> 'branding_visibility')::branding_visibility_enum,
            v ->> 'strongest_sellers', v ->> 'most_customer_requests', v ->> 'most_mechanic_requests',
            (v ->> 'serves_mechanics')::boolean,
            (v ->> 'mechanics_visiting_weekly')::weekly_mechanics_band_enum,
            (v ->> 'can_refer_workshops')::boolean,
            (v ->> 'promo_sales_to_date')::int, v ->> 'competitor_price_comparison',
            (v ->> 'new_stock_received')::boolean, v ->> 'notes', uid, v_sub)
    RETURNING visit_id INTO v_visit;

    FOR v_item IN SELECT jsonb_array_elements_text(COALESCE(v -> 'products_stocked', '[]'::jsonb)) LOOP
        INSERT INTO spares_visit_products (visit_id, product_line_id)
        VALUES (v_visit, _lookup_id('castrol_product_lines', 'product_line_id', v_item, 'product line'))
        ON CONFLICT DO NOTHING;
    END LOOP;

    FOR v_item IN SELECT jsonb_array_elements_text(COALESCE(v -> 'competitor_brands', '[]'::jsonb)) LOOP
        INSERT INTO spares_visit_competitors (visit_id, brand_id)
        VALUES (v_visit, _lookup_id('competitor_brands', 'brand_id', v_item, 'competitor brand'))
        ON CONFLICT DO NOTHING;
    END LOOP;

    FOR v_price IN SELECT key, value FROM jsonb_each_text(COALESCE(v -> 'prices_zar', '{}'::jsonb)) LOOP
        INSERT INTO spares_visit_prices (visit_id, sku_id, price_zar)
        VALUES (v_visit, _lookup_id('castrol_skus', 'sku_id', v_price.key, 'price item', 'label'),
                v_price.value::numeric);
    END LOOP;

    -- consent is per shop manager; log it on the first visit or when the answer changes
    SELECT consent_given INTO v_last FROM consent_log
     WHERE shop_id = v_shop AND purpose = 'fastscan_activation'
     ORDER BY recorded_at DESC, consent_id DESC LIMIT 1;
    IF NOT FOUND OR v_last IS DISTINCT FROM (c ->> 'given')::boolean THEN
        INSERT INTO consent_log (shop_id, consent_given, consent_method, consent_text_version,
                                 evidence_ref, captured_by_user, recorded_at)
        VALUES (v_shop, (c ->> 'given')::boolean, (c ->> 'method')::consent_method_enum,
                c ->> 'text_version', c ->> 'evidence_ref', uid,
                _clamp_ts(c ->> 'recorded_at'));
    END IF;

    RETURN jsonb_build_object('shop_id', v_shop, 'visit_id', v_visit, 'new_shop', v_new, 'duplicate', FALSE);
END;
$$;

-- update_fastscan_status: the only way a rep changes registration / scan data
-- after capture. Only the keys present in the patch change. Registering needs a
-- current POPIA "given" on file. Stamps last_interaction_date.
-- patch keys: is_registered, registration_date, first_scan_completed, total_scans,
--             service_kit_distributed, kit_items_given, incentive_distributed,
--             not_scanning_reason, notes
CREATE OR REPLACE FUNCTION update_fastscan_status(p_mechanic_id BIGINT, patch JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    uid     UUID := auth.uid();
    v_owner UUID;
    v_reg   BOOLEAN;
    v_ok    BOOLEAN;
BEGIN
    IF uid IS NULL OR current_app_role() IS NULL THEN
        RAISE EXCEPTION 'not signed in, or account is inactive' USING ERRCODE = '42501';
    END IF;
    IF patch IS NULL OR jsonb_typeof(patch) <> 'object' OR pg_column_size(patch) > 20000 THEN
        RAISE EXCEPTION 'bad patch' USING ERRCODE = '22023';
    END IF;

    SELECT captured_by_user INTO v_owner FROM mechanics WHERE mechanic_id = p_mechanic_id;
    IF NOT FOUND OR NOT can_access(v_owner) THEN
        RAISE EXCEPTION 'record not found' USING ERRCODE = '42501';
    END IF;

    SELECT CASE WHEN patch ? 'is_registered' THEN (patch ->> 'is_registered')::boolean
                ELSE is_fastscan_registered END
      INTO v_reg FROM fastscan_status WHERE mechanic_id = p_mechanic_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record not found' USING ERRCODE = '42501';
    END IF;

    IF v_reg THEN
        SELECT consent_given INTO v_ok FROM consent_log
         WHERE mechanic_id = p_mechanic_id AND purpose = 'fastscan_activation'
         ORDER BY recorded_at DESC, consent_id DESC LIMIT 1;
        IF NOT COALESCE(v_ok, FALSE) THEN
            RAISE EXCEPTION 'CONSENT_REQUIRED: cannot register for FastScan without POPIA consent'
                  USING ERRCODE = 'FS422';
        END IF;
    END IF;

    UPDATE fastscan_status f SET
        is_fastscan_registered  = v_reg,
        registration_date       = CASE WHEN patch ? 'registration_date' THEN (patch ->> 'registration_date')::date ELSE f.registration_date END,
        first_scan_completed    = CASE WHEN patch ? 'first_scan_completed' THEN (patch ->> 'first_scan_completed')::boolean ELSE f.first_scan_completed END,
        total_scans             = CASE WHEN patch ? 'total_scans' THEN (patch ->> 'total_scans')::int ELSE f.total_scans END,
        service_kit_distributed = CASE WHEN patch ? 'service_kit_distributed' THEN (patch ->> 'service_kit_distributed')::boolean ELSE f.service_kit_distributed END,
        kit_items_given         = CASE WHEN patch ? 'kit_items_given' THEN patch ->> 'kit_items_given' ELSE f.kit_items_given END,
        incentive_distributed   = CASE WHEN patch ? 'incentive_distributed' THEN (patch ->> 'incentive_distributed')::boolean ELSE f.incentive_distributed END,
        not_scanning_reason_id  = CASE WHEN patch ? 'not_scanning_reason'
                                       THEN _lookup_id('not_scanning_reasons', 'reason_id', patch ->> 'not_scanning_reason', 'not_scanning_reason')
                                       ELSE f.not_scanning_reason_id END,
        fastscan_notes          = CASE WHEN patch ? 'notes' THEN patch ->> 'notes' ELSE f.fastscan_notes END,
        last_interaction_date   = (now() AT TIME ZONE 'Africa/Johannesburg')::date
    WHERE f.mechanic_id = p_mechanic_id;

    RETURN jsonb_build_object('mechanic_id', p_mechanic_id, 'ok', TRUE);
END;
$$;

-- record_consent: log a change of mind (for example withdrawal) for a mechanic.
-- consent_log is append-only, so a withdrawal is a new row, never an edit.
CREATE OR REPLACE FUNCTION record_consent(p_mechanic_id BIGINT, p_given BOOLEAN, p_method TEXT,
                                          p_text_version TEXT, p_evidence_ref TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
    uid     UUID := auth.uid();
    v_owner UUID;
BEGIN
    IF uid IS NULL OR current_app_role() IS NULL THEN
        RAISE EXCEPTION 'not signed in, or account is inactive' USING ERRCODE = '42501';
    END IF;
    IF p_given IS NULL THEN
        RAISE EXCEPTION 'given is required' USING ERRCODE = '22023';
    END IF;
    SELECT captured_by_user INTO v_owner FROM mechanics WHERE mechanic_id = p_mechanic_id;
    IF NOT FOUND OR NOT can_access(v_owner) THEN
        RAISE EXCEPTION 'record not found' USING ERRCODE = '42501';
    END IF;
    INSERT INTO consent_log (mechanic_id, consent_given, consent_method, consent_text_version,
                             evidence_ref, captured_by_user, recorded_at)
    VALUES (p_mechanic_id, p_given, p_method::consent_method_enum, p_text_version, p_evidence_ref, uid, now());
    RETURN jsonb_build_object('mechanic_id', p_mechanic_id, 'consent_given', p_given);
END;
$$;

-- Function permissions. Postgres lets everyone (PUBLIC) run new functions, and
-- Supabase also grants anon and authenticated, so close that for ours first.
-- (set_updated_at and consent_log_immutable are trigger functions from 001; a
-- trigger only needs EXECUTE when it is created, so closing them is safe.)
REVOKE ALL ON FUNCTION handle_new_user(), prevent_owner_change(),
                       set_updated_at(), consent_log_immutable(),
                       current_app_role(), is_manager(), can_access(UUID),
                       _lookup_id(TEXT, TEXT, TEXT, TEXT, TEXT), _gps_point(JSONB), _sast_date(TEXT), _clamp_ts(TEXT),
                       update_fastscan_status(BIGINT, JSONB), record_consent(BIGINT, BOOLEAN, TEXT, TEXT, TEXT),
                       submit_onboarding(JSONB), submit_spares_visit(JSONB)
    FROM PUBLIC, anon, authenticated;

-- Signed-in users may call the two submit functions...
GRANT EXECUTE ON FUNCTION submit_onboarding(JSONB)   TO authenticated;
GRANT EXECUTE ON FUNCTION submit_spares_visit(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION update_fastscan_status(BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION record_consent(BIGINT, BOOLEAN, TEXT, TEXT, TEXT) TO authenticated;
-- ...and the three helpers the RLS policies call as the logged-in user.
GRANT EXECUTE ON FUNCTION current_app_role()         TO authenticated;
GRANT EXECUTE ON FUNCTION is_manager()               TO authenticated;
GRANT EXECUTE ON FUNCTION can_access(UUID)           TO authenticated;
-- _lookup_id, _gps_point, _sast_date, handle_new_user and prevent_owner_change
-- stay internal: only the submit functions and triggers (running as owner) use them.

COMMIT;

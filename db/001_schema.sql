-- ============================================================================
-- FastScan field database, v2: three databases
--   1. Mechanics Profile      -> mechanics.database_kind = 'mechanics_profile'
--   2. Independent Mechanics  -> mechanics.database_kind = 'independent_mechanic'
--   3. Spares                 -> spares_shops + spares_visits (+ prices, products)
--
-- Mechanics Profile and Independent Mechanics share one set of tables (the two
-- Excel tabs have the same columns) and are exposed as separate views:
--   v_mechanics_profile, v_independent_mechanics
-- Spares has a different shape (a shop audit), so it has its own tables.
--
-- Target: PostgreSQL 14+ with PostGIS.   Run: psql -d fastscan -f schema.sql
-- On Supabase, if it cannot find geography/citext, put this at the very top:
--   set search_path to public, extensions;
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email

-- ----------------------------------------------------------------------------
-- Fixed sets (enums). Things that rarely change.
-- ----------------------------------------------------------------------------
CREATE TYPE database_kind_enum AS ENUM ('mechanics_profile', 'independent_mechanic');

CREATE TYPE language_enum AS ENUM (
    'English', 'Afrikaans', 'isiZulu', 'isiXhosa', 'Sesotho', 'Setswana',
    'Sepedi', 'Xitsonga', 'Tshivenda', 'siSwati', 'isiNdebele', 'Other'
);

CREATE TYPE consent_method_enum AS ENUM (
    'signed_physical_form', 'in_app_checkbox', 'sms_optin', 'whatsapp_optin',
    'verbal_recorded', 'imported_legacy', 'other'
);

CREATE TYPE vehicles_band_enum AS ENUM ('0-5', '6-10', '11-15', '16-20', '20+');
CREATE TYPE years_in_operation_enum AS ENUM ('1-3 years', '4-7 years', '8-15 years', '15+ years');
CREATE TYPE stock_level_enum AS ENUM ('Low', 'Medium', 'High');
CREATE TYPE branding_visibility_enum AS ENUM ('None', 'Limited', 'Moderate', 'Strong');
CREATE TYPE weekly_mechanics_band_enum AS ENUM ('1-10', '11-25', '26-50', '50+');

-- ----------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Lookup tables (dropdown lists a manager can extend without a code change).
-- Seeded from the values actually found in the Excel workbook.
-- ----------------------------------------------------------------------------
CREATE TABLE regions (
    region_id   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO regions (name) VALUES ('Gauteng North'), ('Gauteng East'), ('Gauteng South');

CREATE TABLE business_types (
    business_type_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO business_types (name) VALUES
    ('Mechanical Workshop'), ('Independent Mechanic'), ('Independent Workshop'),
    ('Auto Electrical'), ('Auto Spares'), ('Taxi Owner'), ('Other');

CREATE TABLE training_backgrounds (      -- the column the sheet mislabels "Intellegence ID"
    training_background_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                   VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO training_backgrounds (name) VALUES
    ('Self-Taught Mechanic'), ('Apprentice Mechanic'), ('Workshop Owner'),
    ('Trade-Tested Mechanic'), ('NQF Level 5 or Higher'), ('Qualified Artisan');

CREATE TABLE specialisations (
    specialisation_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO specialisations (name) VALUES
    ('Engine Repairs'), ('General Mechanical'), ('Auto Electrical'),
    ('Gearbox Specialist'), ('Bikes'), ('Taxi Maintenance'), ('Other');

CREATE TABLE supply_channels (
    supply_channel_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO supply_channels (name) VALUES
    ('Distributors/Wholesalers'), ('Garage/Workshop Networks'), ('Retail Stores'),
    ('Online Suppliers'), ('Spareshops'), ('Other');

-- Why a registered mechanic is not scanning. Replaces keyword-matching on free
-- text, which is how the old dashboard counted these.
CREATE TABLE not_scanning_reasons (
    reason_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO not_scanning_reasons (name) VALUES
    ('Hasn''t started using app yet'),
    ('App technical issue / maintenance'),
    ('Difficult to navigate / login issue'),
    ('No answer / needs call back'),
    ('Voicemail left'),
    ('No space on phone'),
    ('Hasn''t bought new stock yet'),
    ('Other');

CREATE TABLE shop_types (
    shop_type_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO shop_types (name) VALUES
    ('Spare Shop'), ('Auto Parts Retailer'), ('Workshop & Parts Shop');

CREATE TABLE castrol_product_lines (
    product_line_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO castrol_product_lines (name) VALUES
    ('Castrol GTX'), ('Castrol Magnatec'), ('Castrol EDGE'), ('Castrol Actevo'),
    ('Castrol Vecton'), ('Transmission Fluids'), ('Greases'), ('Coolants');

-- The 10 price points the Spares audit records (5L and 1L of five oils)
CREATE TABLE castrol_skus (
    sku_id      SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    label       VARCHAR(80)  NOT NULL UNIQUE,
    pack_litres NUMERIC(4,1) NOT NULL
);
INSERT INTO castrol_skus (label, pack_litres) VALUES
    ('5L Castrol GTX', 5), ('5L Castrol Magnatec Petrol', 5),
    ('5L Castrol Magnatec Petrol & Diesel', 5), ('5L Castrol EDGE', 5),
    ('5L Castrol Actevo', 5),
    ('1L Castrol GTX', 1), ('1L Castrol Magnatec (Petrol)', 1),
    ('1L Castrol Magnatec (Petrol & Diesel)', 1), ('1L Castrol EDGE', 1),
    ('1L Castrol Actevo', 1);

CREATE TABLE competitor_brands (
    brand_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name     VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO competitor_brands (name) VALUES
    ('Shell'), ('Engen'), ('Caltex/Havoline'), ('Liqui Moly'), ('Other');

-- ----------------------------------------------------------------------------
-- DATABASES 1 and 2: workshops + mechanics
-- ----------------------------------------------------------------------------
CREATE TABLE workshops (
    workshop_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workshop_name       VARCHAR(200)  NOT NULL,
    business_type_id    SMALLINT      NOT NULL REFERENCES business_types (business_type_id),
    region_id           SMALLINT      NOT NULL REFERENCES regions (region_id),
    town_suburb         VARCHAR(120),                         -- Soweto, Diepsloot, Tembisa...
    street_address      TEXT,
    gps_location        GEOGRAPHY(Point, 4326),               -- ST_MakePoint(lng, lat)
    vehicles_per_day    vehicles_band_enum,
    branding_requested  BOOLEAN       NOT NULL DEFAULT FALSE,
    branding_notes      TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_workshops_updated
    BEFORE UPDATE ON workshops
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_workshops_region      ON workshops (region_id);
CREATE INDEX idx_workshops_town_suburb ON workshops (town_suburb);
CREATE INDEX idx_workshops_gps         ON workshops USING GIST (gps_location);

CREATE TABLE mechanics (
    mechanic_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mechanic_email         CITEXT             NOT NULL UNIQUE,     -- "Mechanic ID"
    database_kind          database_kind_enum NOT NULL,            -- which of the two databases
    workshop_id            BIGINT             NOT NULL REFERENCES workshops (workshop_id)
                                                  ON DELETE RESTRICT,
    first_name             VARCHAR(100)       NOT NULL,
    surname                VARCHAR(100)       NOT NULL,
    contact_number         VARCHAR(16)        NOT NULL,            -- E.164, +27821234567
    alternative_contact    VARCHAR(16),
    whatsapp_number        VARCHAR(16),
    preferred_language     language_enum,
    experience_months      SMALLINT           CHECK (experience_months BETWEEN 0 AND 840),
    training_background_id SMALLINT           REFERENCES training_backgrounds (training_background_id),
    pays_rent              BOOLEAN,                                -- Independent Mechanics only
    notes                  TEXT,
    captured_by            VARCHAR(120),                           -- replaced by a user link in migration 002
    capture_date           DATE               NOT NULL DEFAULT CURRENT_DATE,
    created_at             TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ        NOT NULL DEFAULT now(),
    CONSTRAINT email_format CHECK (mechanic_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT contact_e164 CHECK (contact_number ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT alt_contact_e164 CHECK (alternative_contact IS NULL
                                       OR alternative_contact ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT whatsapp_e164 CHECK (whatsapp_number IS NULL
                                    OR whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT rent_independent_only CHECK (pays_rent IS NULL
                                            OR database_kind = 'independent_mechanic')
);

CREATE TRIGGER trg_mechanics_updated
    BEFORE UPDATE ON mechanics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_mechanics_workshop ON mechanics (workshop_id);
CREATE INDEX idx_mechanics_kind     ON mechanics (database_kind);
CREATE INDEX idx_mechanics_surname  ON mechanics (surname);

CREATE TABLE mechanic_specialisations (
    mechanic_id       BIGINT   NOT NULL REFERENCES mechanics (mechanic_id) ON DELETE CASCADE,
    specialisation_id SMALLINT NOT NULL REFERENCES specialisations (specialisation_id),
    PRIMARY KEY (mechanic_id, specialisation_id)
);

CREATE TABLE workshop_supply_preferences (
    preference_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workshop_id        BIGINT      NOT NULL UNIQUE REFERENCES workshops (workshop_id)
                                       ON DELETE CASCADE,
    main_oil_brand     VARCHAR(100),
    reason_for_brand   TEXT,
    supply_channel_id  SMALLINT    REFERENCES supply_channels (supply_channel_id),
    supplier_shop_name VARCHAR(200),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_supply_prefs_updated
    BEFORE UPDATE ON workshop_supply_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_supply_prefs_brand ON workshop_supply_preferences (main_oil_brand);

-- FastScan status: one row per mechanic.
--   total_scans is the number that counts as adoption (scans > 0).
--   first_scan_completed is what the agent reported; the two can disagree,
--   see v_scan_data_gaps.
CREATE TABLE fastscan_status (
    status_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mechanic_id             BIGINT      NOT NULL UNIQUE REFERENCES mechanics (mechanic_id)
                                            ON DELETE CASCADE,
    is_fastscan_registered  BOOLEAN     NOT NULL DEFAULT FALSE,
    registration_date       DATE,
    first_scan_completed    BOOLEAN     NOT NULL DEFAULT FALSE,
    total_scans             INTEGER     NOT NULL DEFAULT 0 CHECK (total_scans >= 0),
    last_interaction_date   DATE,
    service_kit_distributed BOOLEAN,                 -- NULL = not tracked for this database
    kit_items_given         TEXT,                    -- e.g. "Castrol bag"
    incentive_distributed   BOOLEAN,
    not_scanning_reason_id  SMALLINT    REFERENCES not_scanning_reasons (reason_id),
    fastscan_notes          TEXT,
    record_creation_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reg_date_when_registered
        CHECK (is_fastscan_registered OR registration_date IS NULL),
    CONSTRAINT scans_need_registration
        CHECK (is_fastscan_registered OR (NOT first_scan_completed AND total_scans = 0))
);

CREATE TRIGGER trg_fastscan_status_updated
    BEFORE UPDATE ON fastscan_status
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_fastscan_registered ON fastscan_status (is_fastscan_registered);
CREATE INDEX idx_fastscan_last_touch ON fastscan_status (last_interaction_date);
CREATE INDEX idx_fastscan_scans      ON fastscan_status (total_scans);

-- ----------------------------------------------------------------------------
-- DATABASE 3: Spares (shop audit: the shop is stable, each visit is a record)
-- ----------------------------------------------------------------------------
CREATE TABLE spares_shops (
    shop_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trading_name        VARCHAR(200) NOT NULL,
    shop_type_id        SMALLINT     REFERENCES shop_types (shop_type_id),
    region_id           SMALLINT     NOT NULL REFERENCES regions (region_id),
    area                VARCHAR(120),
    address             TEXT,
    gps_location        GEOGRAPHY(Point, 4326),
    years_in_operation  years_in_operation_enum,
    manager_first_name  VARCHAR(100),
    manager_surname     VARCHAR(100),
    manager_email       CITEXT       NOT NULL UNIQUE,
    contact_number      VARCHAR(16),
    whatsapp_number     VARCHAR(16),
    captured_by         VARCHAR(120),
    capture_date        DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT shop_email_format CHECK (manager_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT shop_contact_e164 CHECK (contact_number IS NULL
                                        OR contact_number ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT shop_whatsapp_e164 CHECK (whatsapp_number IS NULL
                                         OR whatsapp_number ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TRIGGER trg_spares_shops_updated
    BEFORE UPDATE ON spares_shops
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_spares_shops_region ON spares_shops (region_id);
CREATE INDEX idx_spares_shops_area   ON spares_shops (area);
CREATE INDEX idx_spares_shops_gps    ON spares_shops USING GIST (gps_location);

CREATE TABLE spares_visits (
    visit_id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_id                    BIGINT      NOT NULL REFERENCES spares_shops (shop_id)
                                               ON DELETE CASCADE,
    visit_date                 DATE        NOT NULL DEFAULT CURRENT_DATE,
    captured_by                VARCHAR(120),
    stocks_castrol             BOOLEAN,
    castrol_stock_level        stock_level_enum,
    branding_visibility        branding_visibility_enum,
    strongest_sellers          TEXT,        -- brand names as spoken: "Shell", "Shell Helix"
    most_customer_requests     TEXT,
    most_mechanic_requests     TEXT,
    serves_mechanics           BOOLEAN,
    mechanics_visiting_weekly  weekly_mechanics_band_enum,
    can_refer_workshops        BOOLEAN,
    promo_sales_to_date        INTEGER     CHECK (promo_sales_to_date >= 0),
    competitor_price_comparison TEXT,
    new_stock_received         BOOLEAN,     -- sheet column "New stock"; meaning to be confirmed
    notes                      TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_spares_visits_updated
    BEFORE UPDATE ON spares_visits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_spares_visits_shop ON spares_visits (shop_id, visit_date DESC);

CREATE TABLE spares_visit_products (        -- which Castrol lines the shop stocks
    visit_id        BIGINT   NOT NULL REFERENCES spares_visits (visit_id) ON DELETE CASCADE,
    product_line_id SMALLINT NOT NULL REFERENCES castrol_product_lines (product_line_id),
    PRIMARY KEY (visit_id, product_line_id)
);

CREATE TABLE spares_visit_competitors (     -- which competitor brands are on the shelf
    visit_id BIGINT   NOT NULL REFERENCES spares_visits (visit_id) ON DELETE CASCADE,
    brand_id SMALLINT NOT NULL REFERENCES competitor_brands (brand_id),
    PRIMARY KEY (visit_id, brand_id)
);

-- One row per price actually seen. Not stocked = no row. The sheet stored 0 for
-- "not stocked", which looks like a price of R0 and wrecks averages.
CREATE TABLE spares_visit_prices (
    visit_id  BIGINT        NOT NULL REFERENCES spares_visits (visit_id) ON DELETE CASCADE,
    sku_id    SMALLINT      NOT NULL REFERENCES castrol_skus (sku_id),
    price_zar NUMERIC(8,2)  NOT NULL CHECK (price_zar > 0),
    PRIMARY KEY (visit_id, sku_id)
);

-- ----------------------------------------------------------------------------
-- POPIA consent log (append-only). Subject is a mechanic OR a shop manager.
-- ----------------------------------------------------------------------------
CREATE TABLE consent_log (
    consent_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mechanic_id          BIGINT              REFERENCES mechanics (mechanic_id) ON DELETE RESTRICT,
    shop_id              BIGINT              REFERENCES spares_shops (shop_id)  ON DELETE RESTRICT,
    purpose              VARCHAR(80)         NOT NULL DEFAULT 'fastscan_activation',
    consent_given        BOOLEAN             NOT NULL,       -- TRUE = given, FALSE = withdrawn
    consent_method       consent_method_enum NOT NULL,
    consent_text_version VARCHAR(20)         NOT NULL,       -- 'legacy' for imported rows
    evidence_ref         TEXT,
    captured_by          VARCHAR(120),
    recorded_at          TIMESTAMPTZ         NOT NULL DEFAULT now(),
    CONSTRAINT consent_one_subject CHECK (num_nonnulls(mechanic_id, shop_id) = 1)
);

CREATE INDEX idx_consent_mechanic ON consent_log (mechanic_id, purpose, recorded_at DESC);
CREATE INDEX idx_consent_shop     ON consent_log (shop_id, purpose, recorded_at DESC);

CREATE OR REPLACE FUNCTION consent_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'consent_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consent_no_update
    BEFORE UPDATE OR DELETE ON consent_log
    FOR EACH ROW EXECUTE FUNCTION consent_log_immutable();

-- ----------------------------------------------------------------------------
-- Views
-- ----------------------------------------------------------------------------

-- Latest consent answer per person/shop per purpose
CREATE VIEW v_current_consent AS
SELECT DISTINCT ON (mechanic_id, shop_id, purpose)
       mechanic_id, shop_id, purpose, consent_given, consent_method,
       consent_text_version, recorded_at
FROM consent_log
ORDER BY mechanic_id, shop_id, purpose, recorded_at DESC, consent_id DESC;

-- Everything about a mechanic in one row (the shape of the Excel tabs)
CREATE VIEW v_mechanic_flat AS
SELECT
    m.database_kind,
    m.capture_date                              AS "Date",
    m.captured_by                               AS "Captured by",
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
LEFT JOIN training_backgrounds tb       ON tb.training_background_id = m.training_background_id
LEFT JOIN workshop_supply_preferences p ON p.workshop_id = w.workshop_id
LEFT JOIN supply_channels sc            ON sc.supply_channel_id = p.supply_channel_id
LEFT JOIN fastscan_status f             ON f.mechanic_id = m.mechanic_id
LEFT JOIN not_scanning_reasons nr       ON nr.reason_id = f.not_scanning_reason_id
LEFT JOIN v_current_consent c           ON c.mechanic_id = m.mechanic_id
                                       AND c.purpose = 'fastscan_activation';

-- The two mechanic databases, as separate views (= the two Excel tabs)
CREATE VIEW v_mechanics_profile     AS SELECT * FROM v_mechanic_flat WHERE database_kind = 'mechanics_profile';
CREATE VIEW v_independent_mechanics AS SELECT * FROM v_mechanic_flat WHERE database_kind = 'independent_mechanic';

-- Spares: each shop with its latest visit
CREATE VIEW v_spares_latest AS
SELECT
    s.shop_id,
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
    v.notes                                     AS "Notes"
FROM spares_shops s
JOIN regions r ON r.region_id = s.region_id
LEFT JOIN shop_types st ON st.shop_type_id = s.shop_type_id
LEFT JOIN LATERAL (
    SELECT * FROM spares_visits sv
     WHERE sv.shop_id = s.shop_id
     ORDER BY sv.visit_date DESC, sv.visit_id DESC
     LIMIT 1
) v ON TRUE;

-- Safe list for campaign sends: consent must currently be TRUE
CREATE VIEW v_contactable_mechanics AS
SELECT m.mechanic_id, m.mechanic_email, m.first_name, m.surname,
       m.whatsapp_number, m.contact_number, m.preferred_language
FROM mechanics m
JOIN v_current_consent c ON c.mechanic_id = m.mechanic_id
                        AND c.purpose = 'fastscan_activation'
                        AND c.consent_given;

-- Dashboard: the "Registry & Adoption" block of the old hidden dashboard,
-- one row per database plus a combined row.
CREATE VIEW v_adoption_summary AS
SELECT
    COALESCE(m.database_kind::text, 'combined')                          AS database,
    count(*)                                                             AS total_mechanics,
    count(*) FILTER (WHERE f.is_fastscan_registered)                     AS registered,
    count(*) FILTER (WHERE f.first_scan_completed)                       AS first_scan_flagged,
    COALESCE(sum(f.total_scans), 0)                                      AS total_scans,
    count(*) FILTER (WHERE f.total_scans > 0)                            AS actual_adopters,
    count(*) FILTER (WHERE f.is_fastscan_registered AND f.total_scans = 0) AS registered_zero_scans,
    round(100.0 * count(*) FILTER (WHERE f.total_scans > 0)
          / NULLIF(count(*), 0), 1)                                      AS adoption_pct
FROM mechanics m
JOIN fastscan_status f ON f.mechanic_id = m.mechanic_id
GROUP BY ROLLUP (m.database_kind);

-- Dashboard: "Top reasons mechanics aren't scanning"
CREATE VIEW v_not_scanning_reasons AS
SELECT COALESCE(nr.name, '(no reason recorded)') AS reason,
       m.database_kind,
       count(*)                                  AS mechanics
FROM mechanics m
JOIN fastscan_status f ON f.mechanic_id = m.mechanic_id
LEFT JOIN not_scanning_reasons nr ON nr.reason_id = f.not_scanning_reason_id
WHERE f.is_fastscan_registered AND f.total_scans = 0
GROUP BY nr.name, m.database_kind;

-- Data check: agent said "first scan done" but no scans are logged
CREATE VIEW v_scan_data_gaps AS
SELECT m.mechanic_id, m.mechanic_email, m.database_kind, m.captured_by,
       f.first_scan_completed, f.total_scans
FROM mechanics m
JOIN fastscan_status f ON f.mechanic_id = m.mechanic_id
WHERE f.first_scan_completed AND f.total_scans = 0;

COMMIT;

-- ----------------------------------------------------------------------------
-- Example queries
-- ----------------------------------------------------------------------------
--   SELECT * FROM v_adoption_summary;
--   SELECT * FROM v_independent_mechanics WHERE "Region" = 'Gauteng South';
--   SELECT "Spare shop trading name", "Prices (ZAR)" FROM v_spares_latest WHERE "Stocks Castrol?";
--   -- Shops within 10 km of Johannesburg CBD:
--   SELECT trading_name FROM spares_shops
--   WHERE ST_DWithin(gps_location, ST_MakePoint(28.0473, -26.2041)::geography, 10000);

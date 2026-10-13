#!/usr/bin/env python3
"""
DEV ONLY. Tests migration 002 (logins, attribution, Row Level Security, submit
functions, dashboard views) against a throwaway Postgres that already has
00_supabase_stub.sql, 001_schema.sql and 002_reps_and_rls.sql loaded.

    python3 db/tests/test_002.py            (see db/tests/run.sh to set everything up)

Every test acts as a real database role (authenticated / anon) with a JWT user
id, the same way Supabase's API does, so Row Level Security is really enforced.
"""
import copy, json, os, sys, uuid
import psycopg2, psycopg2.extras
from psycopg2.extras import Json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
DSN = os.environ.get("FS_DSN", "host=/var/lib/postgresql/fs-test port=5544 user=postgres dbname=fs")
MECH = json.load(open(os.path.join(ROOT, "payloads", "onboarding.example.mechanic.json")))
SPAR = json.load(open(os.path.join(ROOT, "payloads", "onboarding.example.spares.json")))

adm = psycopg2.connect(DSN)
adm.autocommit = True
ac = adm.cursor()


def admin(sql, args=None):
    ac.execute(sql, args)
    return ac.fetchall() if ac.description else []


def count(table, where="true"):
    return admin(f"select count(*) from {table} where {where}")[0][0]


class Actor:
    """A database session that behaves like one Supabase API caller."""

    def __init__(self, uid=None, role="authenticated"):
        self.c = psycopg2.connect(DSN)
        self.c.autocommit = False
        cur = self.c.cursor()
        cur.execute(f"SET ROLE {role}")
        if uid:
            cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
        self.c.commit()
        self.cur = cur

    def q(self, sql, args=None):
        try:
            self.cur.execute(sql, args)
            rows = self.cur.fetchall() if self.cur.description else []
            self.c.commit()
            return rows
        except Exception:
            self.c.rollback()
            raise

    def val(self, sql, args=None):
        rows = self.q(sql, args)
        return rows[0][0] if rows else None

    def err(self, sql, args=None):
        """Run a statement that must fail. Returns (sqlstate, message)."""
        try:
            self.q(sql, args)
        except psycopg2.Error as e:
            return (e.pgcode, str(e).strip().splitlines()[0])
        raise AssertionError(f"expected an error but it succeeded: {sql[:90]}")

    def submit(self, payload):
        fn = "submit_spares_visit" if payload["database"] == "spares" else "submit_onboarding"
        return self.val(f"select {fn}(%s::jsonb)", (Json(payload),))


# ---------------------------------------------------------------------------
# test runner
# ---------------------------------------------------------------------------
results = []


def check(name, fn):
    try:
        fn()
        results.append((name, True, ""))
        print(f"  PASS  {name}")
    except AssertionError as e:
        results.append((name, False, str(e)))
        print(f"  FAIL  {name}\n        {e}")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"  ERROR {name}\n        {type(e).__name__}: {e}")


def eq(a, b, what=""):
    assert a == b, f"{what} expected {b!r}, got {a!r}"


def mech(email, kind="independent_mechanic", **mods):
    p = copy.deepcopy(MECH)
    p["client_submission_id"] = str(uuid.uuid4())
    p["database"] = kind
    p["mechanic"]["email"] = email
    if kind == "mechanics_profile":
        p["mechanic"].pop("pays_rent", None)
    for path, v in mods.items():
        d = p
        keys = path.split("__")
        for k in keys[:-1]:
            d = d[k]
        d[keys[-1]] = v
    return p


def spar(email="naledi@example.com", **mods):
    p = copy.deepcopy(SPAR)
    p["client_submission_id"] = str(uuid.uuid4())
    p["shop"]["manager"]["email"] = email
    for path, v in mods.items():
        d = p
        keys = path.split("__")
        for k in keys[:-1]:
            d = d[k]
        d[keys[-1]] = v
    return p


# ---------------------------------------------------------------------------
# users: A and B reps, C tries to make himself manager through metadata,
# M manager, X deactivated rep
# ---------------------------------------------------------------------------
def mkuser(email, meta=None):
    return admin("insert into auth.users (email, raw_user_meta_data) values (%s, %s) returning id",
                 (email, Json(meta or {})))[0][0]


A = mkuser("rep.a@example.com", {"full_name": "Rep A"})
B = mkuser("rep.b@example.com", {"full_name": "Rep B"})
C = mkuser("sneaky@example.com", {"full_name": "Rep C", "role": "manager"})
M = mkuser("boss@example.com", {"full_name": "Boss M"})
X = mkuser("gone@example.com", {"full_name": "Rep X"})
admin("update profiles set role = 'manager' where id = %s", (M,))
admin("update profiles set active = false where id = %s", (X,))
OUTSIDER = uuid.uuid4()  # signed in but has no profile

a, b, m, x = Actor(A), Actor(B), Actor(M), Actor(X)
c_ = Actor(C)
anon = Actor(None, "anon")
ghost = Actor(OUTSIDER)

print("\n== profiles and logins")


def t_profiles():
    eq(count("profiles"), 5, "profiles created by trigger")
    eq(admin("select full_name from profiles where id=%s", (A,))[0][0], "Rep A", "name from metadata")
    eq(admin("select role from profiles where id=%s", (C,))[0][0], "rep", "role in user metadata must be ignored")


def t_profile_fallback_name():
    u = mkuser("no.name@example.com")
    eq(admin("select full_name from profiles where id=%s", (u,))[0][0], "no.name", "name falls back to email prefix")


def t_profile_visibility():
    eq(a.val("select count(*) from profiles"), 1, "rep sees only own profile")
    eq(m.val("select count(*) from profiles"), 6, "manager sees all profiles")
    eq(x.val("select count(*) from profiles"), 1, "inactive rep can still read own profile")
    eq(ghost.val("select count(*) from profiles"), 0, "user without profile sees nothing")


def t_rep_cannot_change_role():
    a.q("update profiles set role = 'manager' where id = %s", (A,))
    eq(admin("select role from profiles where id=%s", (A,))[0][0], "rep", "rep promoted himself")
    a.q("update profiles set role = 'manager' where id = %s", (B,))
    eq(admin("select role from profiles where id=%s", (B,))[0][0], "rep", "rep promoted someone else")
    a.q("update profiles set active = false where id = %s", (B,))
    eq(admin("select active from profiles where id=%s", (B,))[0][0], True, "rep deactivated someone")


def t_no_profile_insert_delete():
    code, _ = a.err("insert into profiles (id, full_name) values (gen_random_uuid(), 'x')")
    eq(code, "42501", "rep inserted a profile")
    code, _ = m.err("insert into profiles (id, full_name) values (gen_random_uuid(), 'x')")
    eq(code, "42501", "manager inserted a profile through the API")
    code, _ = m.err("delete from profiles where id = %s", (B,))
    eq(code, "42501", "manager deleted a profile through the API")


check("a profile is created for every new login; metadata cannot make a manager", t_profiles)
check("name falls back to the email prefix", t_profile_fallback_name)
check("reps see only themselves, manager sees all", t_profile_visibility)
check("a rep cannot change roles or deactivate anyone", t_rep_cannot_change_role)
check("nobody can insert or delete profiles through the API", t_no_profile_insert_delete)

print("\n== anonymous and signed-out access")


def t_anon():
    for t in ["mechanics", "workshops", "profiles", "consent_log", "regions", "spares_shops",
              "v_mechanic_flat", "v_rep_performance", "v_spares_latest", "v_adoption_summary"]:
        code, _ = anon.err(f"select 1 from {t} limit 1")
        eq(code, "42501", f"anon select from {t}")
    code, _ = anon.err("select submit_onboarding(%s::jsonb)", (Json(mech("anon@example.com")),))
    eq(code, "42501", "anon calling submit_onboarding")
    code, _ = anon.err("select submit_spares_visit(%s::jsonb)", (Json(spar("anon@example.com")),))
    eq(code, "42501", "anon calling submit_spares_visit")


def t_no_profile_user_cannot_submit():
    code, msg = ghost.err("select submit_onboarding(%s::jsonb)", (Json(mech("ghost@example.com")),))
    eq(code, "42501", "user with no profile submitted")


def t_inactive_cannot_submit_or_read():
    code, _ = x.err("select submit_onboarding(%s::jsonb)", (Json(mech("x@example.com")),))
    eq(code, "42501", "inactive rep submitted")
    eq(x.val("select count(*) from mechanics"), 0, "inactive rep reads mechanics")
    eq(x.val("select count(*) from regions"), 0, "inactive rep reads lookups")


check("anon has no access to any table, view or submit function", t_anon)
check("a signed-in user without a profile cannot submit", t_no_profile_user_cannot_submit)
check("a deactivated rep cannot submit and sees no data", t_inactive_cannot_submit_or_read)

print("\n== submitting mechanics")
P1 = mech("thabo.mokoena@example.com")
R1 = {}


def t_submit_ok():
    r = a.submit(P1)
    R1.update(r)
    eq(r["duplicate"], False, "duplicate flag")
    row = admin("select captured_by_user, capture_date, database_kind, experience_months, first_name "
                "from mechanics where mechanic_id=%s", (r["mechanic_id"],))[0]
    eq(str(row[0]), str(A), "mechanic stamped with the rep")
    eq(str(row[1]), "2026-10-12", "capture date")
    eq(row[2], "independent_mechanic", "database kind")
    eq(row[3], 144, "12 years stored as months")
    eq(admin("select captured_by_user from workshops where workshop_id=%s", (r["workshop_id"],))[0][0], A, "workshop stamped")
    eq(count("consent_log", f"mechanic_id={r['mechanic_id']} and captured_by_user='{A}' and consent_given"), 1, "consent logged with rep")
    eq(count("mechanic_specialisations", f"mechanic_id={r['mechanic_id']}"), 2, "specialisations")
    eq(count("workshop_supply_preferences", f"workshop_id={r['workshop_id']}"), 1, "supply prefs")
    eq(count("fastscan_status", f"mechanic_id={r['mechanic_id']} and is_fastscan_registered"), 1, "status row")


def t_gps_real_postgis():
    lat, lng = admin("select ST_Y(gps_location::geometry), ST_X(gps_location::geometry) from workshops where workshop_id=%s",
                     (R1["workshop_id"],))[0]
    assert abs(lat - -26.1034) < 1e-9 and abs(lng - 28.0961) < 1e-9, (lat, lng)
    eq(count("workshops", "ST_DWithin(gps_location, ST_MakePoint(28.0961,-26.1034)::geography, 100)"), 1, "radius search")
    flat = m.q('select "GPS latitude", "GPS longitude" from v_mechanic_flat')[0]
    assert abs(flat[0] - -26.1034) < 1e-9 and abs(flat[1] - 28.0961) < 1e-9, flat


def t_retry_is_safe():
    before = (count("mechanics"), count("workshops"), count("consent_log"))
    r = a.submit(P1)
    eq(r["duplicate"], True, "retry flagged as duplicate")
    eq(r["mechanic_id"], R1["mechanic_id"], "same mechanic id")
    eq((count("mechanics"), count("workshops"), count("consent_log")), before, "retry added rows")


def t_submission_id_not_stealable():
    stolen = copy.deepcopy(P1)
    code, _ = b.err("select submit_onboarding(%s::jsonb)", (Json(stolen),))
    eq(code, "42501", "another rep replayed my submission id")


def t_duplicate_email():
    before = (count("mechanics"), count("workshops"), count("fastscan_status"), count("consent_log"))
    for who in (a, b):
        code, msg = who.err("select submit_onboarding(%s::jsonb)", (Json(mech("THABO.mokoena@example.com")),))
        eq(code, "FS409", "duplicate email error code")
        assert "DUPLICATE_EMAIL" in msg, msg
    eq((count("mechanics"), count("workshops"), count("fastscan_status"), count("consent_log")), before,
       "failed submit left rows behind")


def t_profile_kind():
    r = b.submit(mech("linda.dube@example.com", "mechanics_profile", mechanic__preferred_language="isiZulu",
                      workshop__business_type="Mechanical Workshop", workshop__region="Gauteng East"))
    R1["b"] = r
    eq(admin("select database_kind from mechanics where mechanic_id=%s", (r["mechanic_id"],))[0][0], "mechanics_profile")


def t_pays_rent_only_independent():
    before = count("workshops")
    p = mech("rent.bug@example.com", "mechanics_profile")
    p["mechanic"]["pays_rent"] = True
    code, _ = b.err("select submit_onboarding(%s::jsonb)", (Json(p),))
    eq(code, "23514", "pays_rent on a Mechanics Profile")
    eq(count("workshops"), before, "partial rows")


def t_manager_can_submit():
    r = m.submit(mech("by.manager@example.com"))
    eq(admin("select captured_by_user from mechanics where mechanic_id=%s", (r["mechanic_id"],))[0][0], M)


def t_validation_errors_leave_nothing_behind():
    cases = {
        "unknown region": (dict(workshop__region="Western Cape"), "22023"),
        "unknown business type": (dict(workshop__business_type="Spaceship"), "22023"),
        "bad vehicles band": (dict(workshop__vehicles_per_day="30"), "22P02"),
        "phone not E.164": (dict(mechanic__contact_number="0821234567"), "23514"),
        "bad email": (dict(mechanic__email="not-an-email"), "23514"),
        "scans but not registered": (dict(fastscan_status__is_registered=False, fastscan_status__total_scans=3,
                                          fastscan_status__registration_date=None), "23514"),
        "unknown specialisation": (dict(mechanic__specialisations=["Rocket science"]), "22023"),
        "negative scans": (dict(fastscan_status__total_scans=-1), "23514"),
        "unknown consent method": (dict(consent__method="telepathy"), "22P02"),
    }
    for label, (mods, code) in cases.items():
        before = (count("mechanics"), count("workshops"), count("fastscan_status"), count("consent_log"),
                  count("mechanic_specialisations"))
        p = mech(f"v{uuid.uuid4().hex[:8]}@example.com", **mods)
        if label == "scans but not registered":
            p["fastscan_status"].pop("registration_date", None)
        got, msg = a.err("select submit_onboarding(%s::jsonb)", (Json(p),))
        eq(got, code, f"{label}: {msg}")
        after = (count("mechanics"), count("workshops"), count("fastscan_status"), count("consent_log"),
                 count("mechanic_specialisations"))
        eq(after, before, f"{label}: rows left behind")


def t_registration_needs_consent():
    p = mech("noconsent@example.com", consent__given=False)
    code, msg = a.err("select submit_onboarding(%s::jsonb)", (Json(p),))
    eq(code, "FS422", "register without consent")
    assert "CONSENT_REQUIRED" in msg, msg
    # not registering, consent refused: allowed, recorded as refused, never contactable
    p = mech("refused@example.com", consent__given=False, fastscan_status__is_registered=False)
    p["fastscan_status"].pop("registration_date", None)
    r = a.submit(p)
    eq(admin("select consent_given from consent_log where mechanic_id=%s", (r["mechanic_id"],))[0][0], False)
    eq(count("v_contactable_mechanics", "mechanic_email='refused@example.com'"), 0, "refusal must not be contactable")
    eq(count("v_contactable_mechanics", "mechanic_email='thabo.mokoena@example.com'"), 1, "consenting mechanic is contactable")


def t_wrong_function_for_database():
    code, _ = a.err("select submit_onboarding(%s::jsonb)", (Json(spar("wrong.fn@example.com")),))
    assert code in ("22P02", "22023"), code
    p = mech("wrong.fn2@example.com")
    code, _ = a.err("select submit_spares_visit(%s::jsonb)", (Json(p),))
    assert code in ("22023", "42501", "22P02"), code


def t_dates_in_johannesburg_time():
    # 22:30 UTC on 11 Oct is 00:30 on 12 Oct in South Africa (a past time, so the clamp does not touch it)
    r = a.submit(mech("late.night@example.com", captured_at="2026-10-11T22:30:00+00:00"))
    eq(str(admin("select capture_date from mechanics where mechanic_id=%s", (r["mechanic_id"],))[0][0]), "2026-10-12")
    r = a.submit(mech("early.evening@example.com", captured_at="2026-10-11T21:30:00+00:00"))
    eq(str(admin("select capture_date from mechanics where mechanic_id=%s", (r["mechanic_id"],))[0][0]), "2026-10-11")


def t_future_device_clock_is_clamped():
    r = a.submit(mech("future.clock@example.com", captured_at="2030-01-01T10:00:00+02:00"))
    d = admin("select capture_date, (now() at time zone 'Africa/Johannesburg')::date from mechanics where mechanic_id=%s", (r["mechanic_id"],))[0]
    assert d[0] <= d[1], f"capture date {d[0]} is in the future (today is {d[1]})"


check("a rep's capture is stamped with the rep on every table", t_submit_ok)
check("GPS is stored with real PostGIS and radius search works", t_gps_real_postgis)
check("retrying the same submission is safe (offline retry)", t_retry_is_safe)
check("another rep cannot replay my submission id", t_submission_id_not_stealable)
check("duplicate email is refused cleanly, for any rep, case-insensitively", t_duplicate_email)
check("a Mechanics Profile capture works", t_profile_kind)
check("pays_rent is refused on a Mechanics Profile", t_pays_rent_only_independent)
check("a manager can capture too", t_manager_can_submit)
check("bad data is refused and leaves no half-saved rows", t_validation_errors_leave_nothing_behind)
check("registering needs POPIA consent; a refusal is recorded and never contactable", t_registration_needs_consent)
check("each submit function refuses the other database's payload", t_wrong_function_for_database)
check("capture date uses South African time", t_dates_in_johannesburg_time)
check("a device clock set in the future is clamped to today", t_future_device_clock_is_clamped)

print("\n== isolation between reps")


def t_isolation():
    ids_a = {r[0] for r in a.q("select mechanic_id from mechanics")}
    ids_b = {r[0] for r in b.q("select mechanic_id from mechanics")}
    assert ids_a and ids_b and not (ids_a & ids_b), (ids_a, ids_b)
    for t in ["mechanics", "workshops", "workshop_supply_preferences", "mechanic_specialisations",
              "fastscan_status", "consent_log", "v_mechanic_flat", "v_mechanics_profile",
              "v_independent_mechanics", "v_current_consent", "v_contactable_mechanics",
              "v_captures_daily"]:
        na, nb = a.val(f"select count(*) from {t}"), b.val(f"select count(*) from {t}")
        assert na >= 0 and nb >= 0
    # B must see zero independent mechanics (A's), A must see zero mechanics profiles (B's)
    eq(b.val("select count(*) from v_independent_mechanics"), 0, "B sees A's independent mechanics")
    eq(a.val("select count(*) from v_mechanics_profile"), 0, "A sees B's profiles")
    eq(b.val("select count(*) from mechanics where mechanic_email ilike 'thabo%%'"), 0, "B finds A's mechanic by email")
    eq(b.val("select count(*) from consent_log where mechanic_id=%s", (R1["mechanic_id"],)), 0, "B reads A's consent")
    eq(b.val("select count(*) from workshops where workshop_id=%s", (R1["workshop_id"],)), 0, "B reads A's workshop")
    eq(b.val("select count(*) from fastscan_status where mechanic_id=%s", (R1["mechanic_id"],)), 0, "B reads A's status")
    eq(b.val("select count(*) from workshop_supply_preferences where workshop_id=%s", (R1["workshop_id"],)), 0, "B reads A's supply")


def t_manager_sees_all():
    eq(m.val("select count(*) from mechanics"), count("mechanics"), "manager mechanics")
    eq(m.val("select count(*) from workshops"), count("workshops"), "manager workshops")
    eq(m.val("select count(*) from consent_log"), count("consent_log"), "manager consent")
    eq(m.val("select count(*) from fastscan_status"), count("fastscan_status"), "manager status")
    eq(m.val("select count(*) from v_mechanic_flat"), count("mechanics"), "manager flat view")


def t_unattributed_rows_manager_only():
    admin("""insert into workshops (workshop_name, business_type_id, region_id) values ('Legacy WS', 1, 1)""")
    wid = admin("select max(workshop_id) from workshops")[0][0]
    admin("""insert into mechanics (mechanic_email, database_kind, workshop_id, first_name, surname, contact_number, captured_by_legacy)
             values ('legacy@example.com','mechanics_profile',%s,'Old','Row','+27820000000','import')""", (wid,))
    # defaults: captured_by_user is auth.uid() = NULL for the admin session
    eq(admin("select captured_by_user from mechanics where mechanic_email='legacy@example.com'")[0][0], None)
    # an import must create the status row too, or the adoption views cannot see the mechanic
    admin("insert into fastscan_status (mechanic_id) select mechanic_id from mechanics where mechanic_email='legacy@example.com'")
    eq(a.val("select count(*) from mechanics where mechanic_email='legacy@example.com'"), 0, "rep sees an unattributed legacy row")
    eq(m.val("select count(*) from mechanics where mechanic_email='legacy@example.com'"), 1, "manager misses the legacy row")
    eq(m.val('select "Captured by" from v_mechanic_flat where "Mechanic ID (Email Address)"=%s', ("legacy@example.com",)), "import")


check("reps cannot see each other's rows in any table or view", t_isolation)
check("a manager sees everything", t_manager_sees_all)
check("imported rows with no rep are visible to managers only", t_unattributed_rows_manager_only)

print("\n== no direct writes, no tampering")


def t_no_direct_insert_delete():
    for sql in ["insert into mechanics (mechanic_email, workshop_id, first_name, surname, contact_number, database_kind) values ('d@example.com',1,'a','b','+27820000000','independent_mechanic')",
                "insert into workshops (workshop_name, business_type_id, region_id) values ('x',1,1)",
                "insert into consent_log (mechanic_id, consent_given, consent_method, consent_text_version) values (1,true,'other','v1')",
                "insert into fastscan_status (mechanic_id) values (1)",
                "insert into spares_shops (trading_name, region_id, manager_email) values ('x',1,'x@example.com')",
                "delete from mechanics", "delete from workshops", "delete from consent_log", "delete from fastscan_status",
                "truncate mechanics"]:
        for who, label in ((a, "rep"), (m, "manager")):
            code, _ = who.err(sql)
            eq(code, "42501", f"{label}: {sql[:50]}")


def t_consent_log_is_immutable():
    code, _ = a.err("update consent_log set consent_given = false")
    eq(code, "42501", "rep updated consent_log")
    code, _ = m.err("update consent_log set consent_given = false")
    eq(code, "42501", "manager updated consent_log")
    try:
        admin("update consent_log set consent_given = false")
        raise AssertionError("even the owner could edit consent_log")
    except psycopg2.Error as e:
        assert "append-only" in str(e), e


def t_rep_edits_own_only():
    mid = R1["mechanic_id"]
    eq(len(a.q("update mechanics set notes = 'edited by A' where mechanic_id=%s returning 1", (mid,))), 1, "rep edits own")
    eq(len(b.q("update mechanics set notes = 'hacked by B' where mechanic_id=%s returning 1", (mid,))), 0, "B edited A's record")
    eq(admin("select notes from mechanics where mechanic_id=%s", (mid,))[0][0], "edited by A")
    code, _ = b.err("update fastscan_status set total_scans = 99 where mechanic_id=%s", (mid,))
    eq(code, "42501", "B edited A's scans")
    code, _ = b.err("select update_fastscan_status(%s, %s)", (mid, Json({"total_scans": 99})))
    eq(code, "42501", "B edited A's scans via function")
    eq(len(b.q("update workshops set workshop_name = 'hacked' where workshop_id=%s returning 1", (R1["workshop_id"],))), 0, "B edited A's workshop")
    a.q("select update_fastscan_status(%s, %s)", (mid, Json({"total_scans": 5, "first_scan_completed": True})))
    eq(admin("select total_scans, first_scan_completed from fastscan_status where mechanic_id=%s", (mid,))[0], (5, True), "rep updates own status via function")


def t_cannot_hand_record_to_someone_else():
    mid = R1["mechanic_id"]
    code, _ = a.err("update mechanics set captured_by_user = %s where mechanic_id=%s", (B, mid))
    eq(code, "42501", "rep reassigned own record")
    code, _ = a.err("update workshops set captured_by_user = %s where workshop_id=%s", (B, R1["workshop_id"]))
    eq(code, "42501", "rep reassigned own workshop")
    eq(len(m.q("update mechanics set captured_by_user = %s where mechanic_id=%s returning 1", (B, mid))), 1, "manager reassigns")
    eq(len(m.q("update mechanics set captured_by_user = %s where mechanic_id=%s returning 1", (A, mid))), 1, "manager reassigns back")


def t_lookup_tables():
    assert a.val("select count(*) from regions") == 3
    code, _ = a.err("insert into regions (name) values ('Hacked')")
    eq(code, "42501", "rep inserted a lookup value")
    eq(len(m.q("insert into regions (name) values ('Limpopo') returning 1")), 1, "manager extends lookups")
    admin("delete from regions where name='Limpopo'")


def t_helpers_not_callable():
    for sql in ["select _lookup_id('regions','region_id','Gauteng North','x')", "select handle_new_user()",
                "select _gps_point('{}'::jsonb)", "select _sast_date('2026-01-01')", "select prevent_owner_change()"]:
        code, _ = a.err(sql)
        eq(code, "42501", sql)


check("no direct inserts or deletes through the API, for reps or managers", t_no_direct_insert_delete)
check("consent_log can never be edited or deleted", t_consent_log_is_immutable)
check("a rep edits only own records (record, workshop, scans)", t_rep_edits_own_only)
check("a rep cannot hand a record to someone else; a manager can", t_cannot_hand_record_to_someone_else)
check("lookup lists: everyone reads, only managers write", t_lookup_tables)
check("internal helper functions are not callable by users", t_helpers_not_callable)

print("\n== spares")
S = {}


def t_spares_new_shop():
    r = a.submit(spar())
    S.update(r)
    eq(r["new_shop"], True)
    eq(r["duplicate"], False)
    eq(count("spares_visit_prices", f"visit_id={r['visit_id']}"), 3, "prices")
    eq(count("spares_visit_products", f"visit_id={r['visit_id']}"), 3, "products")
    eq(count("spares_visit_competitors", f"visit_id={r['visit_id']}"), 2, "competitors")
    eq(admin("select captured_by_user from spares_shops where shop_id=%s", (r["shop_id"],))[0][0], A, "shop stamped")
    eq(admin("select captured_by_user from spares_visits where visit_id=%s", (r["visit_id"],))[0][0], A, "visit stamped")
    eq(count("consent_log", f"shop_id={r['shop_id']}"), 1, "consent")
    lat = admin("select ST_Y(gps_location::geometry) from spares_shops where shop_id=%s", (r["shop_id"],))[0][0]
    assert abs(lat - -26.0205) < 1e-9, lat


def t_spares_retry():
    pr = copy.deepcopy(SPAR); pr["client_submission_id"] = str(uuid.uuid4()); pr["shop"]["manager"]["email"] = "retry2.shop@example.com"
    first = a.submit(pr)
    again = a.submit(pr)
    eq(again["duplicate"], True)
    eq(again["visit_id"], first["visit_id"])


def t_spares_revisit_same_rep():
    p = spar(visit__stocks_castrol=False, visit__visit_date="2026-10-20", visit__promo_sales_to_date=4,
             visit__prices_zar={"5L Castrol GTX": 510})
    r = a.submit(p)
    eq(r["new_shop"], False)
    eq(r["shop_id"], S["shop_id"], "same shop")
    eq(count("spares_visits", f"shop_id={S['shop_id']}"), 2, "visits")
    eq(count("consent_log", f"shop_id={S['shop_id']}"), 1, "same consent answer must not be logged twice")
    latest = a.q('select "Date of latest visit", "Promo sales to date", "Prices (ZAR)" from v_spares_latest where shop_id=%s', (S["shop_id"],))[0]
    eq(str(latest[0]), "2026-10-20", "latest visit shown")
    eq(latest[1], 4)
    eq(float(latest[2]["5L Castrol GTX"]), 510.0)
    eq(len(latest[2]), 1, "latest visit has only its own prices")


def t_spares_other_rep_blocked_and_blind():
    code, msg = b.err("select submit_spares_visit(%s::jsonb)", (Json(spar("NALEDI@example.com")),))
    eq(code, "FS409", "B visiting A's shop")
    assert "SHOP_EXISTS" in msg, msg
    for t in ["spares_shops", "spares_visits", "spares_visit_products", "spares_visit_competitors",
              "spares_visit_prices", "v_spares_latest"]:
        eq(b.val(f"select count(*) from {t}"), 0, f"B sees {t}")
    eq(b.val("select count(*) from consent_log where shop_id is not null"), 0, "B sees shop consent")


def t_spares_manager_sees_and_can_visit():
    assert m.val("select count(*) from v_spares_latest") >= 1
    r = m.submit(spar("naledi@example.com", visit__visit_date="2026-10-25"))
    eq(r["new_shop"], False)
    eq(admin("select captured_by_user from spares_visits where visit_id=%s", (r["visit_id"],))[0][0], M)


def t_spares_validation():
    before = (count("spares_shops"), count("spares_visits"), count("spares_visit_prices"))
    for label, mods, codes in [
        ("price zero", dict(visit__prices_zar={"5L Castrol GTX": 0}), {"23514"}),
        ("unknown sku", dict(visit__prices_zar={"20L Castrol GTX": 900}), {"22023"}),
        ("unknown product", dict(visit__products_stocked=["Castrol Unicorn"]), {"22023"}),
        ("bad stock level", dict(visit__castrol_stock_level="Huge"), {"22P02"}),
        ("bad shop email", dict(shop__manager__email="nope"), {"23514"}),
        ("unknown region", dict(shop__region="Narnia"), {"22023"}),
    ]:
        p = spar(f"v{uuid.uuid4().hex[:8]}@example.com", **mods)
        if label == "bad shop email":
            p["shop"]["manager"]["email"] = "nope"
        code, msg = a.err("select submit_spares_visit(%s::jsonb)", (Json(p),))
        assert code in codes, f"{label}: {code} {msg}"
    eq((count("spares_shops"), count("spares_visits"), count("spares_visit_prices")), before, "rows left behind")


def t_spares_consent_change_is_logged():
    p = spar("naledi@example.com", consent__given=False, visit__visit_date="2026-10-26")
    r = a.submit(p)
    eq(count("consent_log", f"shop_id={S['shop_id']}"), 2, "withdrawn consent must be appended")
    eq(admin("select consent_given from consent_log where shop_id=%s order by consent_id desc limit 1", (S["shop_id"],))[0][0], False)


check("a rep captures a new shop and its first visit", t_spares_new_shop)
check("retrying a spares submission is safe", t_spares_retry)
check("a rep re-audits their own shop; latest visit and prices show", t_spares_revisit_same_rep)
check("another rep cannot visit or see a shop they do not own", t_spares_other_rep_blocked_and_blind)
check("a manager sees the shop and can add a visit", t_spares_manager_sees_and_can_visit)
check("bad spares data is refused with nothing half-saved", t_spares_validation)
check("withdrawn consent at a revisit is appended to the log", t_spares_consent_change_is_logged)

print("\n== dashboard")


def t_rep_performance_manager():
    rows = {r[0]: r for r in m.q("select rep_name, mechanics_captured, shops_captured, people_captured, shop_visits, "
                                  "registered, adopters, total_scans, kits_distributed, consent_rate_pct, role from v_rep_performance")}
    assert "Rep A" in rows and "Rep B" in rows and "Boss M" in rows, rows.keys()
    ra, rb = rows["Rep A"], rows["Rep B"]
    # A: thabo (registered, 5 scans after update, no kit flag), late.night, future.clock, refused@, + 2 more mechanics
    eq(ra[1], count("mechanics", f"captured_by_user='{A}'"), "A mechanics")
    eq(ra[2], count("spares_shops", f"captured_by_user='{A}'"), "A shops")
    assert ra[2] >= 2, ra  # naledi + the retry shop
    eq(ra[3], ra[1] + ra[2], "people captured = mechanics + shops")
    assert ra[4] >= 3, ra  # visits
    eq(rb[1], 1, "B mechanics")
    eq(rb[2], 0, "B shops")
    eq(rows["Rep X"][1], 0)
    eq(rows["Rep C"][1], 0)
    assert ra[7] >= 5, f"total scans {ra[7]}"
    assert ra[6] >= 1, "adopters"


def t_rep_sees_only_own_performance():
    rows = a.q("select rep_name, mechanics_captured from v_rep_performance")
    eq(len(rows), 1, "rep sees one row")
    eq(rows[0][0], "Rep A")
    rows = b.q("select rep_name, mechanics_captured, shops_captured, shop_visits from v_rep_performance")
    eq(rows, [("Rep B", 1, 0, 0)], "B's numbers")  # B has captured exactly one mechanic so far


def t_today_counts_use_capture_day():
    # one capture made today, one captured offline 3 days ago and only synced now:
    # both are created_at = now, but only the first is "today"
    before = b.q("select captured_today, captured_7d, captured_30d, mechanics_captured from v_rep_performance")[0]
    b.submit(mech("today.one@example.com", captured_at=admin("select now()::text")[0][0]))
    b.submit(mech("three.days.ago@example.com", captured_at=admin("select (now() - interval '3 days')::text")[0][0]))
    after = b.q("select captured_today, captured_7d, captured_30d, mechanics_captured from v_rep_performance")[0]
    eq(after[3] - before[3], 2, "B mechanics added")
    eq(after[0] - before[0], 1, "today: the offline capture synced just now must not count as today")
    eq(after[1] - before[1], 2, "last 7 days")
    eq(after[2] - before[2], 2, "last 30 days")


def t_daily_view():
    rows = b.q("select day, database, captures from v_captures_daily order by day")
    eq(sum(r[2] for r in rows), 3, "B daily total")  # linda + today.one + three.days.ago
    mrows = m.q("select sum(captures) from v_captures_daily")
    eq(mrows[0][0], count("mechanics") + count("spares_shops"), "manager daily total")


def t_adoption_views():
    rows = {r[0]: r for r in m.q("select database, total_mechanics, registered, actual_adopters from v_adoption_summary")}
    eq(rows["combined"][1], count("mechanics"), "combined total")
    ra = a.q("select database, total_mechanics from v_adoption_summary")
    assert all(r[1] <= count("mechanics", f"captured_by_user='{A}'") for r in ra), ra
    eq(b.val("select count(*) from v_scan_data_gaps"), 0)
    assert m.val("select count(*) from v_not_scanning_reasons") >= 1


check("manager sees correct per-rep numbers", t_rep_performance_manager)
check("a rep sees only their own performance row", t_rep_sees_only_own_performance)
check("'today' counts the day of capture, not the day it synced", t_today_counts_use_capture_day)
check("daily capture view adds up", t_daily_view)
check("adoption views respect who is asking", t_adoption_views)

print("\n== structural safety nets (these catch future mistakes)")


def t_views_are_invoker():
    rows = admin("""select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relkind='v'
                      and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')  -- PostGIS's own views
                      and not coalesce('security_invoker=true' = any(c.reloptions), false)""")
    eq(rows, [], "views that bypass RLS (run as owner)")


def t_every_table_has_rls():
    rows = admin("""select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity
                      and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')""")
    eq(rows, [], "tables without RLS")


def t_anon_has_nothing():
    rows = admin("""select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relkind in ('r','p','v','m')
                      and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
                      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger'))""")
    eq(rows, [], "objects anon can touch")
    rows = admin("""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.prokind='f'
                      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
                      and has_function_privilege('anon', p.oid, 'execute')""")
    eq(rows, [], "our functions anon can execute")


def t_authenticated_cannot_delete_or_insert_anything_core():
    rows = admin("""select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relkind in ('r','p')
                      and c.relname in ('mechanics','workshops','consent_log','fastscan_status','spares_shops',
                                        'spares_visits','spares_visit_prices','spares_visit_products',
                                        'spares_visit_competitors','mechanic_specialisations',
                                        'workshop_supply_preferences','profiles')
                      and (has_table_privilege('authenticated', c.oid, 'insert')
                           or has_table_privilege('authenticated', c.oid, 'delete')
                           or has_table_privilege('authenticated', c.oid, 'truncate'))""")
    eq(rows, [], "core tables with insert/delete/truncate for logged-in users")


def t_functions_executable_by_users():
    rows = {r[0] for r in admin("""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.prokind='f'
                      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
                      and has_function_privilege('authenticated', p.oid, 'execute')""")}
    allowed = {"submit_onboarding", "submit_spares_visit", "update_fastscan_status", "record_consent",
               "current_app_role", "is_manager", "can_access"}
    eq(rows - allowed, set(), "unexpected functions callable by logged-in users")


check("every view runs as the caller (so RLS applies)", t_views_are_invoker)
check("every table has Row Level Security on", t_every_table_has_rls)
check("anon can touch no table, view or function of ours", t_anon_has_nothing)
check("logged-in users cannot insert, delete or truncate core tables", t_authenticated_cannot_delete_or_insert_anything_core)
check("only the intended functions are callable by logged-in users", t_functions_executable_by_users)

print("\n== review fixes")


def t_no_direct_status_or_consent_updates():
    mid = R1["mechanic_id"]
    for sql in ["update fastscan_status set total_scans = 99 where mechanic_id=%s",
                "update fastscan_status set is_fastscan_registered = true where mechanic_id=%s",
                "update consent_log set consent_given = true where mechanic_id=%s"]:
        code, _ = a.err(sql, (mid,))
        eq(code, "42501", sql)


def t_protected_columns():
    mid, wid = R1["mechanic_id"], R1["workshop_id"]
    other = admin("select workshop_id from workshops where captured_by_user=%s limit 1", (B,))
    cols = ["update mechanics set capture_date = '2020-01-01' where mechanic_id=%s",
            "update mechanics set created_at = '2020-01-01' where mechanic_id=%s",
            "update mechanics set mechanic_email = 'squat@example.com' where mechanic_id=%s",
            "update mechanics set client_submission_id = gen_random_uuid() where mechanic_id=%s",
            "update mechanics set database_kind = 'mechanics_profile' where mechanic_id=%s"]
    for sql in cols:
        code, _ = a.err(sql, (mid,))
        eq(code, "42501", sql)
    if other:
        code, _ = a.err("update mechanics set workshop_id = %s where mechanic_id=%s", (other[0][0], mid))
        eq(code, "42501", "repoint workshop")
    code, _ = a.err("update workshops set created_at = '2020-01-01' where workshop_id=%s", (wid,))
    eq(code, "42501", "workshop created_at")


def t_spares_protected_columns():
    r = a.q("select submit_spares_visit(%s)", (Json(spar("protect@example.com")),))[0][0]
    for sql in ["update spares_visits set shop_id = 1 where visit_id=%s",
                "update spares_visits set created_at = '2020-01-01' where visit_id=%s"]:
        code, _ = a.err(sql, (r["visit_id"],))
        eq(code, "42501", sql)
    for sql in ["update spares_shops set capture_date = '2020-01-01' where shop_id=%s",
                "update spares_shops set manager_email = 'x@example.com' where shop_id=%s"]:
        code, _ = a.err(sql, (r["shop_id"],))
        eq(code, "42501", sql)
    eq(len(a.q("update spares_shops set area = 'Edited' where shop_id=%s returning 1", (r["shop_id"],))), 1, "safe edit ok")


def t_infinity_consent_clamped():
    p = mech("inf@example.com", consent__recorded_at="infinity")
    r = a.q("select submit_onboarding(%s)", (Json(p),))[0][0]
    ts = admin("select recorded_at from consent_log where mechanic_id=%s", (r["mechanic_id"],))[0][0]
    assert ts.year < 3000, ts
    p = mech("neginf@example.com", consent__recorded_at="-infinity")
    r = a.q("select submit_onboarding(%s)", (Json(p),))[0][0]
    ts = admin("select recorded_at from consent_log where mechanic_id=%s", (r["mechanic_id"],))[0][0]
    assert ts.year > 1900, ts
    p = mech("inf2@example.com", captured_at="infinity")
    r = a.q("select submit_onboarding(%s)", (Json(p),))[0][0]
    d = admin("select capture_date from mechanics where mechanic_id=%s", (r["mechanic_id"],))[0][0]
    assert d.year < 3000, d


def t_status_function():
    p = mech("status@example.com", consent__given=False, fastscan_status__is_registered=False)
    p["fastscan_status"].pop("registration_date", None)
    r = a.q("select submit_onboarding(%s)", (Json(p),))[0][0]
    mid = r["mechanic_id"]
    code, _ = a.err("select update_fastscan_status(%s, %s)", (mid, Json({"is_registered": True})))
    eq(code, "FS422", "register without consent")
    a.q("select record_consent(%s, true, 'in_app_checkbox', 'v1-draft', null)", (mid,))
    a.q("select update_fastscan_status(%s, %s)", (mid, Json({"is_registered": True, "registration_date": "2026-10-12", "total_scans": 4})))
    eq(admin("select is_fastscan_registered, total_scans from fastscan_status where mechanic_id=%s", (mid,))[0], (True, 4), "registered")
    eq(len(admin("select 1 from consent_log where mechanic_id=%s", (mid,))), 2, "consent appended, not edited")
    code, _ = a.err("select update_fastscan_status(%s, %s)", (mid, Json({"total_scans": -1})))
    eq(code, "23514", "negative scans")
    code, _ = b.err("select update_fastscan_status(%s, %s)", (mid, Json({"total_scans": 50})))
    eq(code, "42501", "other rep")
    code, _ = b.err("select record_consent(%s, false, 'in_app_checkbox', 'v1-draft', null)", (mid,))
    eq(code, "42501", "other rep consent")
    code, _ = anon.err("select update_fastscan_status(%s, %s)", (mid, Json({})))
    assert code is not None, "anon ran it"
    code, _ = x.err("select update_fastscan_status(%s, %s)", (mid, Json({"total_scans": 1})))
    eq(code, "42501", "inactive rep")
    m.q("select update_fastscan_status(%s, %s)", (mid, Json({"total_scans": 6})))
    eq(admin("select total_scans from fastscan_status where mechanic_id=%s", (mid,))[0][0], 6, "manager updates")
    a.q("select record_consent(%s, false, 'verbal_recorded', 'v1-draft', null)", (mid,))
    code, _ = a.err("select update_fastscan_status(%s, %s)", (mid, Json({"is_registered": True})))
    eq(code, "FS422", "re-register after withdrawal")


def t_payload_size_limit():
    p = mech("big@example.com", mechanic__notes="x" * 300000)
    code, _ = a.err("select submit_onboarding(%s)", (Json(p),))
    eq(code, "22023", "oversized payload")


check("reps cannot update fastscan_status or consent_log directly", t_no_direct_status_or_consent_updates)
check("reps cannot touch protected mechanic/workshop columns", t_protected_columns)
check("reps cannot touch protected spares columns", t_spares_protected_columns)
check("infinity timestamps are clamped", t_infinity_consent_clamped)
check("update_fastscan_status and record_consent enforce consent and ownership", t_status_function)
check("oversized payloads are refused", t_payload_size_limit)

# ---------------------------------------------------------------------------
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed, {len(results)} total")
sys.exit(1 if fails else 0)

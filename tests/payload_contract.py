#!/usr/bin/env python3
"""DEV ONLY. Pushes the payloads the app really builds (tests/make-payloads.ts)
through the real submit functions as a rep. Run after db/tests/run.sh.
  npx tsx tests/make-payloads.ts > payloads.json
  FS_DSN="host=/var/lib/postgresql/fs-test port=5544 user=postgres dbname=fs" python3 tests/payload_contract.py payloads.json"""
import json, os, sys, psycopg2
from psycopg2.extras import Json
P = json.load(open(sys.argv[1]))
c = psycopg2.connect(os.environ.get("FS_DSN", "host=/var/lib/postgresql/fs-test port=5544 user=postgres dbname=fs")); c.autocommit = True
cur = c.cursor()
cur.execute("insert into auth.users (email, raw_user_meta_data) values ('contract.rep@example.com','{\"full_name\":\"Contract Rep\"}') returning id")
uid = cur.fetchone()[0]
cur.execute("set role authenticated"); cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
bad = 0
for name, p in P.items():
    fn = "submit_spares_visit" if p["database"] == "spares" else "submit_onboarding"
    try:
        cur.execute(f"select {fn}(%s::jsonb)", (Json(p),)); print("OK  ", name, cur.fetchone()[0])
    except Exception as e:
        bad += 1; print("FAIL", name, str(e).splitlines()[0])
cur.execute("select count(*) from v_mechanic_flat"); print("rep sees mechanics:", cur.fetchone()[0])
cur.execute('select "Prices (ZAR)" from v_spares_latest limit 1'); print("prices:", cur.fetchone())
sys.exit(1 if bad else 0)

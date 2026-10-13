# FastScan Field

Tablet app for Castrol FastScan sales reps. Each rep signs in, hands the tablet to a client (mechanic, shop manager) to fill in, and every capture is saved under the rep's name. Managers see per-rep performance and every client's full details.

Stack: Next.js 16 (App Router) + Tailwind, Supabase (Postgres, Auth, Row Level Security), hosted on Vercel.

## What is in the box

| Path | What it is |
|---|---|
| `db/001_schema.sql` | Tables: Mechanics Profile, Independent Mechanics (same tables, `database_kind`), Spares shops/visits/prices, consent log |
| `db/002_reps_and_rls.sql` | Logins, rep ownership, Row Level Security, submit/update functions, dashboard views |
| `db/tests/` | Dev-only test harness (53 tests, plain Postgres + PostGIS). Not for Supabase |
| `payloads/` | JSON schema + examples of what the app sends |
| `src/` | The app |
| `scripts/create-users.mjs` | Creates rep logins from a CSV (run on your laptop) |
| `tests/` | Dev-only: checks the app's real payloads against the real database functions, plus a fake Supabase for screenshots |

## Set up (in this order)

1. **Create a Supabase project** (supabase.com, region closest to you: Cape Town/`af-south-1` if offered).
2. **Turn off public sign-ups:** Authentication -> Sign In / Providers -> switch off "Allow new users to sign up". Without this a stranger could create a login and become an active rep.
3. **Enable extensions in the `extensions` schema:** Database -> Extensions -> enable `postgis` and `citext` (leave the schema as `extensions`).
4. **Run the SQL:** SQL Editor -> paste all of `db/001_schema.sql` -> Run. Then paste all of `db/002_reps_and_rls.sql` -> Run.
5. **Copy keys:** Project Settings -> API. Copy `.env.example` to `.env.local` and fill `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Only the anon key goes in the app.
6. **Create logins:** make `users.csv` (`full_name,email,password,role`, one row per person, role `rep` or `manager`), then:
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs users.csv`
   The service-role key is a secret: terminal only, never in the app or git.
   (Or add users in Authentication -> Users and promote a manager in the SQL Editor:
   `UPDATE profiles SET role = 'manager' WHERE id = (SELECT id FROM auth.users WHERE email = 'MANAGER@EXAMPLE.COM');`)
7. **Run it:** `npm install` then `npm run dev` (http://localhost:3000). Deploy: push to GitHub, import in Vercel, add the two env vars.
8. **On the tablets:** open the Vercel URL in Chrome -> menu -> "Add to Home screen".

## How it behaves

- **Hand-over:** each form starts with amber "Client fills this in" steps (details, workshop, POPIA permission), then green "Rep only" steps (location, FastScan status). Answers are kept on the tablet if the page reloads.
- **Attribution:** the database stamps the logged-in rep on every row. The rep is never typed in.
- **Privacy:** a rep sees only their own clients. Managers see everyone. Enforced in Postgres, not just the screens.
- **Registration needs consent:** the database refuses to register anyone without POPIA permission on file. Withdrawal is logged as a new row, never an edit.
- **Duplicates:** email is the unique ID. A repeat email is refused with a clear message. Retrying a dropped save never creates two records.
- **Scan numbers are self-reported:** reps type them in. The dashboard marks them with an asterisk.

## Before the pilot

- **Replace the draft consent wording** in `src/lib/options.ts` (`CONSENT_TEXT`) with text approved by your legal team, then change `CONSENT_VERSION`.
- **Not built yet:** offline queue (saving with no signal), signature capture, auto-install prompt. Today, with no signal the form tells the rep to try again and keeps the answers.
- Known and accepted: a "this email is already captured" message tells a rep that an email exists, even if another rep captured it.

## Tests (dev only)

- Database: `bash db/tests/run.sh` (needs Postgres 16 + PostGIS, Linux, root). `FS_EXT_SCHEMA=extensions bash db/tests/run.sh` for the Supabase layout.
- App: `npx tsc --noEmit && npx eslint src && npx next build`.

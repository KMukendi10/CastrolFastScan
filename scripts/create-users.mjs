// Creates rep logins in Supabase from a CSV. Run on YOUR laptop, never in the app.
//
//   1. Make users.csv:      full_name,email,password,role      (role is rep or manager; blank = rep)
//   2. Set the two env vars (Supabase dashboard -> Project Settings -> API):
//        SUPABASE_URL=https://YOUR-PROJECT.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=...           <- secret. Never commit it, never put it in .env.local
//   3. node scripts/create-users.mjs users.csv
//
// The profile row is created by a database trigger. A manager role is then set here.
import { readFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const file = process.argv[2];
if (!url || !key || !file) { console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs users.csv"); process.exit(1); }

const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const rows = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
if (/^full_name/i.test(rows[0])) rows.shift();

for (const line of rows) {
  const [full_name, email, password, role = "rep"] = line.split(",").map((x) => x.trim());
  if (!full_name || !email || !password) { console.log("SKIP (missing field):", line.replace(/,[^,]*,[^,]*$/, ",…")); continue; }
  if (password.length < 8) { console.log("SKIP (password under 8 characters):", email); continue; }
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST", headers: H,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name } }),
  });
  const j = await r.json();
  if (!r.ok) { console.log("FAIL", email, "-", j.msg ?? j.message ?? r.status); continue; }
  if (role === "manager") {
    const p = await fetch(`${url}/rest/v1/profiles?id=eq.${j.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ role: "manager" }) });
    console.log(p.ok ? "OK   manager" : "FAIL made user but not manager:", email);
  } else console.log("OK   rep    ", email);
}

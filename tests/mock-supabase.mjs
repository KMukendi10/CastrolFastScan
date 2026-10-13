// DEV ONLY. A fake Supabase (auth + REST) with canned data, so the UI can be
// screenshotted without a real project. ROLE=rep|manager picks who signs in.
import http from "node:http";
const role = process.env.ROLE ?? "rep";
const uid = "11111111-1111-4111-8111-111111111111";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, email: "demo@example.com" })}.sig`;
const user = { id: uid, aud: "authenticated", role: "authenticated", email: "demo@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const lookups = {
  regions: ["Gauteng North", "Gauteng East", "Gauteng South"].map((name) => ({ name })),
  business_types: ["Independent Mechanic", "Dealer Workshop", "Fleet Workshop"].map((name) => ({ name })),
  training_backgrounds: ["Apprentice Mechanic", "Trade school", "Self-taught"].map((name) => ({ name })),
  specialisations: ["Engine Repairs", "General Mechanical", "Gearbox", "Brakes", "Electrical"].map((name) => ({ name })),
  supply_channels: ["Distributors/Wholesalers", "Spares shop"].map((name) => ({ name })),
  not_scanning_reasons: ["Hasn't started using app yet", "No smartphone"].map((name) => ({ name })),
  shop_types: ["Spare Shop", "Parts Chain"].map((name) => ({ name })),
  castrol_product_lines: ["Castrol GTX", "Castrol Magnatec", "Greases"].map((name) => ({ name })),
  castrol_skus: ["5L Castrol GTX", "1L Castrol GTX"].map((label) => ({ label })),
  competitor_brands: ["Shell", "Engen"].map((name) => ({ name })),
};
const reps = [
  ["Lerato Dlamini", 41, 36, 5, 9, 31, 14, 22, 128, 96.5], ["Sipho Nkosi", 33, 33, 0, 6, 27, 11, 18, 90, 90.9],
  ["Ayanda Pillay", 24, 15, 9, 3, 18, 8, 12, 51, 88.0], ["Johan Botha", 12, 12, 0, 1, 8, 2, 3, 9, 75.0],
].map(([rep_name, people, m, s, d7, reg, ad, today, scans, cons], i) => ({
  rep_id: `r${i}`, rep_name, role: "rep", active: true, mechanics_captured: m, shops_captured: s, people_captured: people, captured_today: Math.min(today, 9),
  captured_7d: d7 * 3, captured_30d: people, registered: reg, adopters: ad, total_scans: scans, consent_rate_pct: cons, last_capture_at: "2026-10-13T08:00:00Z",
}));
const day = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const daily = Array.from({ length: 30 }, (_, i) => ({ day: day(i), captures: [3, 6, 9, 4, 0, 0, 7, 8, 5, 10, 6, 2, 0, 1][i % 14], database: "x" }));
const mech = [
  { mechanic_id: 3, database_kind: "independent_mechanic", "First name": "Thabo", Surname: "Mokoena", "Workshop name": "Thabo Auto Repairs", "FastScan registered": true, "Total scans": 7, "Contact number": "+27821234567", "Date": "2026-10-12", "POPIA consent": true, "First scan completed (agent)": true, Region: "Gauteng North", "Training background": "Apprentice Mechanic", Specialisation: "Engine Repairs, General Mechanical", "Years of experience": 12, "Captured by": "Lerato Dlamini" },
  { mechanic_id: 2, database_kind: "mechanics_profile", "First name": "Zanele", Surname: "Khumalo", "Workshop name": "Midas Soweto", "FastScan registered": false, "Total scans": 0, "Contact number": "+27719876543", "Date": "2026-10-11", "POPIA consent": false },
];
const shops = [{ shop_id: 1, "Spare shop trading name": "Sample Motor Spares", "Manager name": "Naledi", "Manager surname": "Mahlangu", Area: "Tembisa", "Date of latest visit": "2026-10-12", "Contact number": "+27117654321" }];
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (u.pathname.startsWith("/auth/v1/token")) return send(res, 200, { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user });
  if (u.pathname === "/auth/v1/user") return send(res, 200, user);
  if (u.pathname === "/auth/v1/logout") return send(res, 204, {});
  const t = u.pathname.replace("/rest/v1/", "");
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const one = (rows) => (single ? (rows[0] ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "none" })) : send(res, 200, rows));
  if (t.startsWith("rpc/")) { req.resume(); return send(res, 200, { mechanic_id: 9, duplicate: false }); }
  if (t === "profiles") return one([{ id: uid, full_name: role === "manager" ? "Manager" : "Lerato Dlamini", role, active: true }]);
  if (lookups[t]) return send(res, 200, lookups[t]);
  if (t === "v_rep_performance") return one(single ? [reps[0]] : reps);
  if (t === "v_captures_daily") return send(res, 200, daily);
  if (t === "v_mechanic_flat") return one(u.searchParams.get("mechanic_id") ? [mech[0]] : mech);
  if (t === "v_spares_latest") return one(u.searchParams.get("shop_id") ? [shops[0]] : shops);
  send(res, 404, { message: "mock: " + t });
}).listen(54321, () => console.log("mock supabase on 54321, role", role));

// DEV ONLY. Builds payloads with the app's own flow code, so tests/payload_contract.py
// can push them through the real database functions.
import { mechanicFlow } from "../src/components/wizard/mechanicFlow";
import { sparesFlow } from "../src/components/wizard/sparesFlow";

const out: Record<string, unknown> = {};
for (const kind of ["mechanics_profile", "independent_mechanic"] as const) {
  const f = mechanicFlow();
  const s = {
    ...f.initial(), email: `${kind}@example.com`, first_name: "Thabo", surname: "Mokoena", contact: "082 123 4567", alt: "0719876543",
    whatsapp: "", language: "isiZulu", years: "12", training: "Apprentice Mechanic", specs: ["Engine Repairs"], pays_rent: kind === "independent_mechanic" ? true : null,
    w_name: "Thabo Auto", business_type: kind === "independent_mechanic" ? "Independent Mechanic" : "Mechanical Workshop", region: "Gauteng North", town: "Alexandra", address: "14 London Rd", vehicles: "6-10",
    branding: true, branding_notes: "Front wall", oil_brand: "Castrol", reason: "Asked for", channel: "Distributors/Wholesalers", supplier: "Alex Parts",
    consent: true, lat: "-26.1034", lon: "28.0961", acc: "9", registered: true, first_scan: true, total_scans: "3", kit: true, kit_items: "Cap, shirt", incentive: false, not_scanning: "", fs_notes: "ok",
  };
  for (const st of f.steps) if (Object.keys(st.validate(s)).length) throw new Error(kind + " step " + st.id + " invalid");
  out[kind] = f.toPayload(s, crypto.randomUUID());
  const minimal = { ...f.initial(), email: `min-${kind}@example.com`, first_name: "A", surname: "B", contact: "0821234567", w_name: "W", business_type: kind === "independent_mechanic" ? "Independent Mechanic" : "Mechanical Workshop", region: "Gauteng East" };
  for (const st of f.steps) if (Object.keys(st.validate(minimal)).length) throw new Error("minimal " + kind + " " + st.id);
  out["min_" + kind] = f.toPayload(minimal, crypto.randomUUID());
}
const sf = sparesFlow();
const ss = {
  ...sf.initial(), trading_name: "Sample Spares", shop_type: "Spare Shop", region: "Gauteng East", area: "Tembisa", address: "38 Sample St", years_op: "15+ years",
  m_first: "Naledi", m_surname: "Mahlangu", m_email: "naledi.app@example.com", contact: "011 123 4567", whatsapp: "0788620912", consent: true,
  lat: "-26.02", lon: "28.2", acc: "6", stocks: true, level: "Medium", branding: "Strong", products: ["Castrol GTX"], competitors: ["Shell"],
  prices: { "5L Castrol GTX": "488", "1L Castrol GTX": "" }, strongest: "Shell", serves: true, weekly: "26-50", refer: true, promo: "0", new_stock: true, notes: "n",
};
for (const st of sf.steps) if (Object.keys(st.validate(ss)).length) throw new Error("spares step " + st.id);
out.spares = sf.toPayload(ss, crypto.randomUUID());
const sm = { ...sf.initial(), trading_name: "Min Shop", region: "Gauteng East", m_first: "A", m_surname: "B", m_email: "min@example.com" };
for (const st of sf.steps) if (Object.keys(st.validate(sm)).length) throw new Error("min spares " + st.id);
out.min_spares = sf.toPayload(sm, crypto.randomUUID());
console.log(JSON.stringify(out));

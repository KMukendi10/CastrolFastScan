import { Chips, Choice, Field, Select, TextArea, TextInput, YesNo } from "@/components/ui";
import { BRANDING, STOCK_LEVELS, WEEKLY, YEARS_OP, CONSENT_VERSION } from "@/lib/options";
import { emailOk, toE164, todayISO } from "@/lib/format";
import type { Flow, Step } from "./types";
import { GpsField } from "./GpsField";
import { ConsentBox } from "./ConsentBox";
import { OtpVerification } from "./OtpVerification";

export type SState = {
  trading_name: string; shop_type: string; region: string; area: string; address: string; years_op: string;
  m_first: string; m_surname: string; m_email: string; m_emailConfirm: string; contact: string; contactConfirm: string; phoneVerified: boolean; whatsapp: string;
  consent: boolean;
  lat: string; lon: string; acc: string;
  stocks: boolean | null; level: string; branding: string; products: string[]; competitors: string[];
  prices: Record<string, string>;
  strongest: string; cust_req: string; mech_req: string; serves: boolean | null; weekly: string;
  refer: boolean | null; promo: string; price_cmp: string; new_stock: boolean | null; notes: string;
};

const empty = (): SState => ({
  trading_name: "", shop_type: "", region: "", area: "", address: "", years_op: "",
  m_first: "", m_surname: "", m_email: "", m_emailConfirm: "", contact: "", contactConfirm: "", phoneVerified: false, whatsapp: "", consent: false,
  lat: "", lon: "", acc: "", stocks: null, level: "", branding: "", products: [], competitors: [], prices: {},
  strongest: "", cust_req: "", mech_req: "", serves: null, weekly: "", refer: null, promo: "", price_cmp: "",
  new_stock: null, notes: "",
});

const emailMatchStatus = (email: string, confirmation: string) => {
  if (!email.trim() || !confirmation.trim()) return null;
  if (email.trim().toLowerCase() !== confirmation.trim().toLowerCase()) return "mismatch";
  return emailOk(email) ? "match" : null;
};

export function sparesFlow(): Flow<SState> {
  const steps: Step<SState>[] = [
    {
      id: "shop", title: "About the shop", who: "client",
      intro: "Please fill in the shop and manager details.",
      validate: (s) => {
        const e: Record<string, string> = {};
        if (!s.trading_name.trim()) e.trading_name = "Enter the shop name";
        if (!s.region) e.region = "Choose a region";
        if (!s.m_first.trim()) e.m_first = "Enter the manager's first name";
        if (!s.m_surname.trim()) e.m_surname = "Enter the manager's surname";
        if (!emailOk(s.m_email)) e.m_email = "Enter a valid email address";
        else if (s.m_email.trim().toLowerCase() !== s.m_emailConfirm.trim().toLowerCase()) e.m_emailConfirm = "Email addresses do not match";
        if (s.contact.trim() && !toE164(s.contact)) e.contact = "Check this number. Example: 011 123 4567";
        else if (s.contact.trim() && !toE164(s.contactConfirm)) e.contactConfirm = "Confirm the shop phone number";
        else if (s.contact.trim() && toE164(s.contact) !== toE164(s.contactConfirm)) e.contactConfirm = "Phone numbers do not match";
        else if (s.contact.trim() && !s.phoneVerified) e.contact = "Verify this shop phone using the SMS code below";
        if (!s.contact.trim() && s.contactConfirm.trim()) e.contactConfirm = "Enter the shop phone number first";
        if (s.whatsapp.trim() && !toE164(s.whatsapp)) e.whatsapp = "Check this number. Example: 082 123 4567";
        return e;
      },
      render: ({ s, set, e, lk, submissionId }) => (
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Shop name" error={e.trading_name}><TextInput value={s.trading_name} onChange={(x) => set({ trading_name: x.target.value })} /></Field>
          <Field label="Shop type"><Select value={s.shop_type} onChange={(v) => set({ shop_type: v })} options={lk.shopTypes} /></Field>
          <Field label="Region" error={e.region}><Select value={s.region} onChange={(v) => set({ region: v })} options={lk.regions} /></Field>
          <Field label="Area"><TextInput value={s.area} onChange={(x) => set({ area: x.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="Address"><TextInput value={s.address} onChange={(x) => set({ address: x.target.value })} /></Field></div>
          <div className="md:col-span-2"><Field label="Years in operation"><Choice value={s.years_op} onChange={(v) => set({ years_op: v })} options={YEARS_OP} /></Field></div>
          <Field label="Manager first name" error={e.m_first}><TextInput value={s.m_first} onChange={(x) => set({ m_first: x.target.value })} /></Field>
          <Field label="Manager surname" error={e.m_surname}><TextInput value={s.m_surname} onChange={(x) => set({ m_surname: x.target.value })} /></Field>
          <Field label="Manager email" error={e.m_email}><TextInput type="email" inputMode="email" autoComplete="off" value={s.m_email} onChange={(x) => set({ m_email: x.target.value })} /></Field>
          <div>
            <Field label="Confirm manager email" error={e.m_emailConfirm}><TextInput type="email" inputMode="email" autoComplete="off" value={s.m_emailConfirm} onChange={(x) => set({ m_emailConfirm: x.target.value })} /></Field>
            {emailMatchStatus(s.m_email, s.m_emailConfirm) && <p role="status" aria-live="polite" className={`mt-1 text-sm font-semibold ${emailMatchStatus(s.m_email, s.m_emailConfirm) === "match" ? "text-brand" : "text-alert"}`}>
              {emailMatchStatus(s.m_email, s.m_emailConfirm) === "match" ? "Email addresses match." : "Email addresses don’t match."}
            </p>}
          </div>
          <div><Field label="Shop phone number" error={e.contact}><TextInput type="tel" inputMode="tel" value={s.contact} onChange={(x) => set({ contact: x.target.value, phoneVerified: false })} /></Field>{s.contact.trim() && <OtpVerification key={`${submissionId}:phone:${toE164(s.contact) ?? s.contact}`} submissionId={submissionId} kind="phone" contact={toE164(s.contact) ?? ""} verified={s.phoneVerified} onVerified={(phoneVerified) => set({ phoneVerified })} />}</div>
          <Field label="Confirm shop phone number" error={e.contactConfirm}><TextInput type="tel" inputMode="tel" value={s.contactConfirm} onChange={(x) => set({ contactConfirm: x.target.value })} /></Field>
          <Field label="WhatsApp number" error={e.whatsapp}><TextInput type="tel" inputMode="tel" value={s.whatsapp} onChange={(x) => set({ whatsapp: x.target.value })} /></Field>
        </div>
      ),
    },
    {
      id: "consent", title: "Your permission", who: "client",
      intro: "Please read this and tick the box if you agree.",
      validate: () => ({}),
      render: ({ s, set }) => <ConsentBox checked={s.consent} onChange={(v) => set({ consent: v })} />,
    },
    {
      id: "visit", title: "Shop visit", who: "rep",
      intro: "Hand the tablet back. This part is for the sales rep.",
      validate: (s) => {
        const e: Record<string, string> = {};
        for (const [k, v] of Object.entries(s.prices)) if (v.trim() && !(Number(v) > 0)) e["price:" + k] = "Enter a price in rand";
        if (s.promo && !(Number.isInteger(Number(s.promo)) && Number(s.promo) >= 0)) e.promo = "Enter a whole number";
        return e;
      },
      render: ({ s, set, e, lk }) => (
        <>
          <Field label="Shop location"><GpsField value={{ lat: s.lat, lon: s.lon, acc: s.acc }} onChange={(g) => set(g)} /></Field>
          <Field label="Stocks Castrol?"><YesNo value={s.stocks} onChange={(v) => set({ stocks: v })} /></Field>
          <Field label="Castrol stock level"><Choice value={s.level} onChange={(v) => set({ level: v })} options={STOCK_LEVELS} /></Field>
          <Field label="Castrol branding visible in shop"><Choice value={s.branding} onChange={(v) => set({ branding: v })} options={BRANDING} /></Field>
          <Field label="Castrol products stocked"><Chips value={s.products} onChange={(v) => set({ products: v })} options={lk.productLines} /></Field>
          <Field label="Competitor brands stocked"><Chips value={s.competitors} onChange={(v) => set({ competitors: v })} options={lk.competitors} /></Field>
          <fieldset className="space-y-3">
            <legend className="mb-1.5 text-base font-semibold">Shelf prices (rand)</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {lk.skus.map((k) => (
                <Field key={k} label={k} error={e["price:" + k]}>
                  <TextInput type="number" inputMode="decimal" min={0} value={s.prices[k] ?? ""} onChange={(x) => set({ prices: { ...s.prices, [k]: x.target.value } })} />
                </Field>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Strongest selling brand"><TextInput value={s.strongest} onChange={(x) => set({ strongest: x.target.value })} /></Field>
            <Field label="Most asked for by customers"><TextInput value={s.cust_req} onChange={(x) => set({ cust_req: x.target.value })} /></Field>
            <Field label="Most asked for by mechanics"><TextInput value={s.mech_req} onChange={(x) => set({ mech_req: x.target.value })} /></Field>
            <Field label="Competitor price comparison"><TextInput value={s.price_cmp} onChange={(x) => set({ price_cmp: x.target.value })} /></Field>
          </div>
          <Field label="Sells to mechanics?"><YesNo value={s.serves} onChange={(v) => set({ serves: v })} /></Field>
          {s.serves && <Field label="Mechanics visiting per week"><Choice value={s.weekly} onChange={(v) => set({ weekly: v })} options={WEEKLY} /></Field>}
          <Field label="Can refer workshops to us?"><YesNo value={s.refer} onChange={(v) => set({ refer: v })} /></Field>
          <Field label="Promo sales to date" error={e.promo}><TextInput type="number" inputMode="numeric" min={0} value={s.promo} onChange={(x) => set({ promo: x.target.value })} /></Field>
          <Field label="New stock received?"><YesNo value={s.new_stock} onChange={(v) => set({ new_stock: v })} /></Field>
          <Field label="Notes"><TextArea value={s.notes} onChange={(x) => set({ notes: x.target.value })} /></Field>
        </>
      ),
    },
  ];

  return {
    initial: empty,
    steps,
    rpc: "submit_spares_visit",
    toPayload: (s, id) => {
      const n = (v: string) => (v.trim() ? v.trim() : undefined);
      const prices: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.prices)) if (v.trim()) prices[k] = Number(v);
      return {
        client_submission_id: id,
        database: "spares",
        captured_at: new Date().toISOString(),
        shop: {
          trading_name: s.trading_name.trim(), shop_type: n(s.shop_type), region: s.region, area: n(s.area), address: n(s.address),
          gps: s.lat && s.lon ? { latitude: Number(s.lat), longitude: Number(s.lon), accuracy_m: Number(s.acc) } : undefined,
          years_in_operation: n(s.years_op),
          manager: {
            first_name: s.m_first.trim(), surname: s.m_surname.trim(), email: s.m_email.trim(),
            contact_number: s.contact.trim() ? toE164(s.contact) : undefined,
            whatsapp_number: s.whatsapp.trim() ? toE164(s.whatsapp) : undefined,
          },
        },
        visit: {
          visit_date: todayISO(), stocks_castrol: s.stocks ?? undefined, castrol_stock_level: n(s.level), branding_visibility: n(s.branding),
          products_stocked: s.products, prices_zar: prices, competitor_brands: s.competitors,
          strongest_sellers: n(s.strongest), most_customer_requests: n(s.cust_req), most_mechanic_requests: n(s.mech_req),
          serves_mechanics: s.serves ?? undefined, mechanics_visiting_weekly: s.serves ? n(s.weekly) : undefined,
          can_refer_workshops: s.refer ?? undefined, promo_sales_to_date: s.promo ? Number(s.promo) : undefined,
          competitor_price_comparison: n(s.price_cmp), new_stock_received: s.new_stock ?? undefined, notes: n(s.notes),
        },
        consent: { given: s.consent, method: "in_app_checkbox", text_version: CONSENT_VERSION, recorded_at: new Date().toISOString() },
      };
    },
  };
}

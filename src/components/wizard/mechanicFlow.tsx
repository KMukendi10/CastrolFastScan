import { Chips, Choice, Field, Select, TextArea, TextInput, YesNo } from "@/components/ui";
import { LANGUAGES, VEHICLES, CONSENT_TEXT, CONSENT_VERSION, type Kind } from "@/lib/options";
import { emailOk, normalizeGps, toE164, todayISO } from "@/lib/format";
import type { Flow, Step } from "./types";
import { GpsField } from "./GpsField";
import { ConsentBox } from "./ConsentBox";
import { OtpVerification } from "./OtpVerification";

export type MState = {
  email: string; emailConfirm: string; first_name: string; surname: string; contact: string; contactConfirm: string; phoneVerified: boolean; alt: string; whatsapp: string; whatsappSameAsPhone: boolean;
  language: string; years: string; training: string; specs: string[]; pays_rent: boolean | null;
  w_name: string; business_type: string; region: string; town: string; address: string; vehicles: string;
  branding: boolean | null; branding_notes: string;
  oil_brand: string; reason: string; channel: string; supplier: string;
  consent: boolean;
  lat: string; lon: string; acc: string;
  registered: boolean | null; first_scan: boolean | null; total_scans: string;
  kit: boolean | null; kit_items: string; incentive: boolean | null; not_scanning: string; fs_notes: string;
};

const empty = (): MState => ({
  email: "", emailConfirm: "", first_name: "", surname: "", contact: "", contactConfirm: "", phoneVerified: false, alt: "", whatsapp: "", whatsappSameAsPhone: true, language: "", years: "", training: "",
  specs: [], pays_rent: null, w_name: "", business_type: "", region: "", town: "", address: "", vehicles: "",
  branding: null, branding_notes: "", oil_brand: "", reason: "", channel: "", supplier: "", consent: false,
  lat: "", lon: "", acc: "", registered: null, first_scan: null, total_scans: "", kit: null, kit_items: "",
  incentive: null, not_scanning: "", fs_notes: "",
});

const req = (v: string, msg: string, k: string, e: Record<string, string>) => { if (!v.trim()) e[k] = msg; };
const optPhone = (v: string, k: string, e: Record<string, string>) => { if (v.trim() && !toE164(v)) e[k] = "Check this number. Example: 082 123 4567"; };
const emailMatchStatus = (email: string, confirmation: string) => {
  if (!email.trim() || !confirmation.trim()) return null;
  if (email.trim().toLowerCase() !== confirmation.trim().toLowerCase()) return "mismatch";
  return emailOk(email) ? "match" : null;
};

export function mechanicFlow(kind: Exclude<Kind, "spares">): Flow<MState> {
  const independent = kind === "independent_mechanic";

  const steps: Step<MState>[] = [
    {
      id: "person", title: "About the mechanic", who: "client",
      intro: "Please fill in your details.",
      validate: (s) => {
        const e: Record<string, string> = {};
        req(s.first_name, "Enter the first name", "first_name", e);
        req(s.surname, "Enter the surname", "surname", e);
        if (!emailOk(s.email)) e.email = "Enter a valid email address";
        else if (s.email.trim().toLowerCase() !== s.emailConfirm.trim().toLowerCase()) e.emailConfirm = "Email addresses do not match";
        if (!toE164(s.contact)) e.contact = "Enter a cell number. Example: 082 123 4567";
        else if (toE164(s.contact) !== toE164(s.contactConfirm)) e.contactConfirm = "Cell numbers do not match";
        else if (!s.phoneVerified) e.contact = "Verify this cell number using the SMS code below";
        optPhone(s.alt, "alt", e);
        if (!s.whatsappSameAsPhone) {
          if (!s.whatsapp.trim()) e.whatsapp = "Enter the WhatsApp number, or confirm it matches the cell number";
          else optPhone(s.whatsapp, "whatsapp", e);
        }
        if (s.years && !(Number(s.years) >= 0 && Number(s.years) <= 70)) e.years = "Enter years between 0 and 70";
        return e;
      },
      render: ({ s, set, e, lk, submissionId }) => (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="First name" required error={e.first_name}><TextInput autoComplete="off" value={s.first_name} onChange={(x) => set({ first_name: x.target.value })} /></Field>
            <Field label="Surname" required error={e.surname}><TextInput autoComplete="off" value={s.surname} onChange={(x) => set({ surname: x.target.value })} /></Field>
            <Field label="Email address" required error={e.email}><TextInput type="email" inputMode="email" autoComplete="off" value={s.email} onChange={(x) => set({ email: x.target.value })} /></Field>
            <div>
              <Field label="Confirm email address" required error={e.emailConfirm}><TextInput type="email" inputMode="email" autoComplete="off" value={s.emailConfirm} onChange={(x) => set({ emailConfirm: x.target.value })} /></Field>
              {emailMatchStatus(s.email, s.emailConfirm) && <p role="status" aria-live="polite" className={`mt-1 text-sm font-semibold ${emailMatchStatus(s.email, s.emailConfirm) === "match" ? "text-brand" : "text-alert"}`}>
                {emailMatchStatus(s.email, s.emailConfirm) === "match" ? "Email addresses match." : "Email addresses don’t match."}
              </p>}
            </div>
            <div><Field label="Cell number" required error={e.contact}><TextInput type="tel" inputMode="tel" value={s.contact} onChange={(x) => set({ contact: x.target.value, phoneVerified: false })} /></Field><OtpVerification key={`${submissionId}:phone:${toE164(s.contact) ?? s.contact}`} submissionId={submissionId} kind="phone" contact={toE164(s.contact) ?? ""} verified={s.phoneVerified} onVerified={(phoneVerified) => set({ phoneVerified })} /></div>
            <Field label="Confirm cell number" required error={e.contactConfirm}><TextInput type="tel" inputMode="tel" value={s.contactConfirm} onChange={(x) => set({ contactConfirm: x.target.value })} /></Field>
            <div className="md:col-span-2 rounded-xl border-2 border-line p-4">
              <div className="flex items-start gap-3">
                <input
                  id={`whatsapp-same-as-cell-${kind}`}
                  type="checkbox"
                  checked={s.whatsappSameAsPhone !== false}
                  onChange={(event) => set({ whatsappSameAsPhone: event.target.checked, ...(event.target.checked ? { whatsapp: "" } : {}) })}
                  className="mt-1 h-5 w-5 shrink-0 accent-brand"
                />
                <label htmlFor={`whatsapp-same-as-cell-${kind}`} className="cursor-pointer">
                  <span className="block font-semibold">WhatsApp number is the same as the cell number</span>
                  <span className="mt-1 block text-sm text-muted">We’ll use the verified cell number for WhatsApp. Untick this if WhatsApp uses a different number.</span>
                </label>
              </div>
              {!s.whatsappSameAsPhone && <div className="mt-4">
                <Field label="WhatsApp number" required error={e.whatsapp}><TextInput type="tel" inputMode="tel" value={s.whatsapp} onChange={(x) => set({ whatsapp: x.target.value })} /></Field>
              </div>}
            </div>
            <Field label="Another number to reach you" hint="Optional" error={e.alt}><TextInput type="tel" inputMode="tel" value={s.alt} onChange={(x) => set({ alt: x.target.value })} /></Field>
            <Field label="Preferred language"><Select value={s.language} onChange={(v) => set({ language: v })} options={LANGUAGES} /></Field>
            <Field label="Years of experience" error={e.years}><TextInput type="number" inputMode="decimal" min={0} max={70} value={s.years} onChange={(x) => set({ years: x.target.value })} /></Field>
          </div>
          <Field label="Training background"><Select value={s.training} onChange={(v) => set({ training: v })} options={lk.training} /></Field>
          <Field label="What do you work on? (pick all that apply)"><Chips value={s.specs} onChange={(v) => set({ specs: v })} options={lk.specialisations} /></Field>
        </>
      ),
    },
    {
      id: "workshop", title: "Workshop and oil", who: "client",
      intro: "Tell us about where you work.",
      validate: (s) => {
        const e: Record<string, string> = {};
        req(s.w_name, "Enter the workshop name (use your own name if you have none)", "w_name", e);
        req(s.business_type, "Choose a business type", "business_type", e);
        req(s.region, "Choose a region", "region", e);
        return e;
      },
      render: ({ s, set, e, lk }) => (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Workshop name" required error={e.w_name}><TextInput value={s.w_name} onChange={(x) => set({ w_name: x.target.value })} /></Field>
            <Field label="Business type" required error={e.business_type}><Select value={s.business_type} onChange={(v) => set({ business_type: v })} options={lk.businessTypes} /></Field>
            <Field label="Region" required error={e.region}><Select value={s.region} onChange={(v) => set({ region: v })} options={lk.regions} /></Field>
            <Field label="Town or suburb"><TextInput value={s.town} onChange={(x) => set({ town: x.target.value })} /></Field>
          </div>
          <Field label="Street address"><TextInput value={s.address} onChange={(x) => set({ address: x.target.value })} /></Field>
          <Field label="Vehicles serviced per day"><Choice value={s.vehicles} onChange={(v) => set({ vehicles: v })} options={VEHICLES} /></Field>
          {independent && <Field label="Do you pay rent for your space?"><YesNo value={s.pays_rent} onChange={(v) => set({ pays_rent: v })} /></Field>}
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Main oil brand you use"><TextInput value={s.oil_brand} onChange={(x) => set({ oil_brand: x.target.value })} /></Field>
            <Field label="Why that brand?"><TextInput value={s.reason} onChange={(x) => set({ reason: x.target.value })} /></Field>
            <Field label="Where do you buy stock?"><Select value={s.channel} onChange={(v) => set({ channel: v })} options={lk.supplyChannels} /></Field>
            <Field label="Name of the shop you buy from"><TextInput value={s.supplier} onChange={(x) => set({ supplier: x.target.value })} /></Field>
          </div>
          <Field label="Would you like Castrol branding at your workshop?"><YesNo value={s.branding} onChange={(v) => set({ branding: v })} /></Field>
          {s.branding && <Field label="What branding?"><TextInput value={s.branding_notes} onChange={(x) => set({ branding_notes: x.target.value })} /></Field>}
        </>
      ),
    },
    {
      id: "consent", title: "Your permission", who: "client",
      intro: "Please read this and tick the box if you agree.",
      validate: () => ({}),
      render: ({ s, set }) => <ConsentBox checked={s.consent} onChange={(v) => set({ consent: v })} />,
    },
    {
      id: "rep", title: "Castrol FastScan status", who: "rep",
      intro: "Hand the tablet back. This part is for the sales rep.",
      validate: (s) => {
        const e: Record<string, string> = {};
        if (s.registered && !s.consent) e.registered = "Cannot register without the client's permission. Go back to the permission step.";
        if (s.total_scans && !(Number.isInteger(Number(s.total_scans)) && Number(s.total_scans) >= 0)) e.total_scans = "Enter a whole number";
        if (!s.registered && (s.first_scan || Number(s.total_scans) > 0)) e.registered = "A mechanic who has scanned must be registered";
        return e;
      },
      render: ({ s, set, e, lk }) => (
        <>
          <Field label="Workshop location"><GpsField value={{ lat: s.lat, lon: s.lon, acc: s.acc }} onChange={(g) => set(g)} /></Field>
          <Field label="Registered on Castrol FastScan?" error={e.registered}><YesNo value={s.registered} onChange={(v) => set({ registered: v })} /></Field>
          <Field label="Has completed a first scan?"><YesNo value={s.first_scan} onChange={(v) => set({ first_scan: v })} /></Field>
          <Field label="Total scans so far" error={e.total_scans}><TextInput type="number" inputMode="numeric" min={0} value={s.total_scans} onChange={(x) => set({ total_scans: x.target.value })} /></Field>
          {!(Number(s.total_scans) > 0) && <Field label="Why not scanning yet?"><Select value={s.not_scanning} onChange={(v) => set({ not_scanning: v })} options={lk.notScanning} /></Field>}
          <Field label="Service kit handed over?"><YesNo value={s.kit} onChange={(v) => set({ kit: v })} /></Field>
          {s.kit && <Field label="Items given"><TextInput value={s.kit_items} onChange={(x) => set({ kit_items: x.target.value })} /></Field>}
          <Field label="Incentive handed over?"><YesNo value={s.incentive} onChange={(v) => set({ incentive: v })} /></Field>
          <Field label="Castrol FastScan notes"><TextArea value={s.fs_notes} onChange={(x) => set({ fs_notes: x.target.value })} /></Field>
        </>
      ),
    },
  ];

  return {
    initial: empty,
    steps,
    rpc: "submit_onboarding",
    toPayload: (s, id) => {
      const n = (v: string) => (v.trim() ? v.trim() : undefined);
      const today = todayISO();
      return {
        client_submission_id: id,
        database: kind,
        captured_at: new Date().toISOString(),
        mechanic: {
          email: s.email.trim().toLowerCase(), first_name: s.first_name.trim(), surname: s.surname.trim(),
          contact_number: toE164(s.contact), alternative_contact: s.alt.trim() ? toE164(s.alt) : undefined,
          whatsapp_number: s.whatsappSameAsPhone !== false ? toE164(s.contact) : toE164(s.whatsapp),
          preferred_language: n(s.language), experience_years: s.years ? Number(s.years) : undefined,
          training_background: n(s.training), specialisations: s.specs,
          ...(independent && s.pays_rent !== null ? { pays_rent: s.pays_rent } : {}),
        },
        workshop: {
          name: s.w_name.trim(), business_type: s.business_type, region: s.region,
          town_suburb: n(s.town), street_address: n(s.address),
          gps: normalizeGps(s.lat, s.lon, s.acc),
          vehicles_per_day: n(s.vehicles), branding_requested: !!s.branding, branding_notes: s.branding ? n(s.branding_notes) : undefined,
        },
        supply_preferences: s.oil_brand || s.reason || s.channel || s.supplier ? {
          main_oil_brand: n(s.oil_brand), reason_for_brand: n(s.reason), supply_channel: n(s.channel), supplier_shop_name: n(s.supplier),
        } : undefined,
        fastscan_status: {
          is_registered: !!s.registered,
          registration_date: s.registered ? today : undefined,
          first_scan_completed: !!s.first_scan,
          total_scans: s.total_scans ? Number(s.total_scans) : 0,
          service_kit_distributed: s.kit ?? undefined, kit_items_given: s.kit ? n(s.kit_items) : undefined,
          incentive_distributed: s.incentive ?? undefined,
          not_scanning_reason: Number(s.total_scans) > 0 ? undefined : n(s.not_scanning),
          notes: n(s.fs_notes),
        },
        consent: { given: s.consent, method: "in_app_checkbox", text_version: CONSENT_VERSION, recorded_at: new Date().toISOString() },
      };
    },
  };
}

export { CONSENT_TEXT };

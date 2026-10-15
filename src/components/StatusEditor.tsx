"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Banner, Button, Field, TextInput, YesNo } from "@/components/ui";

type Init = { registered: boolean; first_scan: boolean; total_scans: number; kit: boolean | null; incentive: boolean | null };

/** Follow-up changes after capture go through update_fastscan_status(), which checks consent. */
export function StatusEditor({ mechanicId, init, consent, onSaved }: { mechanicId: number; init: Init; consent: boolean; onSaved: () => void }) {
  const [s, setS] = useState({ ...init, scans: String(init.total_scans) });
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState(false);

  async function save() {
    setBusy(true); setMsg(null);
    const patch = {
      is_registered: s.registered, first_scan_completed: s.first_scan, total_scans: Number(s.scans || 0),
      service_kit_distributed: s.kit, incentive_distributed: s.incentive,
      ...(s.registered && !init.registered ? { registration_date: new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }) } : {}),
    };
    const { error } = await supabase().rpc("update_fastscan_status", { p_mechanic_id: mechanicId, patch });
    setBusy(false);
    if (error) setMsg({ tone: "error", text: error.code === "FS422" ? "Cannot register: this client has not given permission." : error.code === "23514" ? "Those numbers do not add up. A client who has scanned must be registered." : error.message });
    else { setMsg({ tone: "ok", text: "Saved" }); onSaved(); }
  }

  async function withdrawConsent() {
    const { error } = await supabase().rpc("record_consent", { p_mechanic_id: mechanicId, p_given: false, p_method: "other", p_text_version: "withdrawal", p_evidence_ref: null });
    if (error) setMsg({ tone: "error", text: error.message }); else { setMsg({ tone: "ok", text: "Permission withdrawn and logged" }); onSaved(); }
    setWithdraw(false);
  }

  return (
    <section className="space-y-5 rounded-2xl bg-card p-5">
      <h2 className="font-display text-2xl font-bold">Update Castrol FastScan status</h2>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {!consent && <Banner tone="info">No permission on file. This client cannot be registered.</Banner>}
      <Field label="Registered on Castrol FastScan?"><YesNo value={s.registered} onChange={(v) => setS({ ...s, registered: !!v })} /></Field>
      <Field label="Completed a first scan?"><YesNo value={s.first_scan} onChange={(v) => setS({ ...s, first_scan: !!v })} /></Field>
      <Field label="Total scans"><TextInput type="number" inputMode="numeric" min={0} value={s.scans} onChange={(e) => setS({ ...s, scans: e.target.value })} /></Field>
      <Field label="Service kit handed over?"><YesNo value={s.kit} onChange={(v) => setS({ ...s, kit: v })} /></Field>
      <Field label="Incentive handed over?"><YesNo value={s.incentive} onChange={(v) => setS({ ...s, incentive: v })} /></Field>
      <div className="flex flex-wrap gap-3">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        {consent && !withdraw && <Button variant="ghost" onClick={() => setWithdraw(true)}>Client withdraws permission</Button>}
        {withdraw && <Button variant="danger" onClick={withdrawConsent}>Confirm withdrawal</Button>}
      </div>
    </section>
  );
}

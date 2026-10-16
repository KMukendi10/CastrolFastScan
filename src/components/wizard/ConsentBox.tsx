import { CONSENT_TEXT } from "@/lib/options";

export function ConsentBox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">FastScan activation consent (POPIA)</h2>
      <p className="rounded-xl border-2 border-line bg-card p-5 text-xl leading-relaxed">{CONSENT_TEXT}</p>
      <label className="flex min-h-16 cursor-pointer items-center gap-4 rounded-xl border-2 border-line bg-card p-4">
        <input type="checkbox" className="size-8 accent-[var(--green)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="text-xl font-semibold">I agree</span>
      </label>
      <p className="text-sm text-muted">You can save this profile without agreeing, but we need your consent to register you on Castrol FastScan.</p>
    </div>
  );
}

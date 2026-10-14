"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";import { SessionGate } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { DailyChart, type Day } from "@/components/DailyChart";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui";
import { toXlsx, downloadXlsx, syncToLiveSheet } from "@/lib/xlsx";
import { toCsv, download as downloadCsv } from "@/lib/csv";
import { todayISO } from "@/lib/format";

type Rep = {
  rep_id: string; rep_name: string; role: string; active: boolean; mechanics_captured: number; shops_captured: number;
  people_captured: number; captured_today: number; captured_7d: number; captured_30d: number; registered: number; adopters: number;
  total_scans: number; consent_rate_pct: number | null; last_capture_at: string | null;
};

const sum = (a: Rep[], k: keyof Rep) => a.reduce((n, r) => n + Number(r[k] ?? 0), 0);

function Dash() {
  const [reps, setReps] = useState<Rep[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => {
    supabase().from("v_rep_performance").select("*").eq("role", "rep").order("people_captured", { ascending: false })
      .then(({ data, error }) => error ? setErr(error.message) : setReps(data as Rep[]));
    const from = new Date(Date.now() - 29 * 864e5).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
    supabase().from("v_captures_daily").select("day, captures").gte("day", from).then(({ data }) => {
      const m = new Map<string, number>();
      for (const r of (data ?? []) as { day: string; captures: number }[]) m.set(r.day, (m.get(r.day) ?? 0) + Number(r.captures));
      const out: Day[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
        out.push({ day: d, captures: m.get(d) ?? 0 });
      }
      setDays(out);
    });
  }, []);

  const totals = useMemo(() => reps ? {
    all: sum(reps, "people_captured"), today: sum(reps, "captured_today"), week: sum(reps, "captured_7d"),
    registered: sum(reps, "registered"), adopters: sum(reps, "adopters"),
  } : null, [reps]);

  async function exportXlsx(view: "v_mechanic_flat" | "v_spares_latest", label: string) {
    setBusy(view); setErr(""); setSyncMsg("");
    const { data, error } = await supabase().from(view).select("*").limit(50000);
    setBusy("");
    if (error) return setErr(error.message);
    const rows = data as Record<string, unknown>[];
    downloadXlsx(`${label}-${todayISO()}.xlsx`, toXlsx(rows));
  }

  async function exportCsv(view: "v_mechanic_flat" | "v_spares_latest", label: string) {
    setBusy("csv-" + view); setErr(""); setSyncMsg("");
    const { data, error } = await supabase().from(view).select("*").limit(50000);
    setBusy("");
    if (error) return setErr(error.message);
    downloadCsv(`${label}-${todayISO()}.csv`, toCsv(data as Record<string, unknown>[]));
  }

  async function syncSheet(view: "v_mechanic_flat" | "v_spares_latest", sheetName: string) {
    setBusy("sync-" + view); setErr(""); setSyncMsg("");
    const { data, error } = await supabase().from(view).select("*").limit(50000);
    setBusy("");
    if (error) return setErr(error.message);
    const rows = data as Record<string, unknown>[];
    const result = await syncToLiveSheet(sheetName, rows);
    setSyncMsg(result.message);
  }

  return (
    <Shell title="Manager dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold">Team performance</h1>
        </div>
        <Link href="/dashboard/reps" className="min-h-14 rounded-xl border-2 border-line bg-card px-6 text-lg font-semibold flex items-center hover:border-brand hover:bg-brand hover:text-white transition-all duration-150">
          Manage reps
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" disabled={!!busy} onClick={() => exportXlsx("v_mechanic_flat", "mechanics")}>
            {busy === "v_mechanic_flat" ? "Preparing…" : "Mechanics (Excel)"}
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => exportCsv("v_mechanic_flat", "mechanics")}>
            {busy === "csv-v_mechanic_flat" ? "Preparing…" : "Mechanics (CSV)"}
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => exportXlsx("v_spares_latest", "spares-shops")}>
            {busy === "v_spares_latest" ? "Preparing…" : "Spares shops (Excel)"}
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => exportCsv("v_spares_latest", "spares-shops")}>
            {busy === "csv-v_spares_latest" ? "Preparing…" : "Spares shops (CSV)"}
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => syncSheet("v_mechanic_flat", "Mechanics")}>
            {busy === "sync-v_mechanic_flat" ? "Syncing…" : "Sync mechanics to live sheet"}
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => syncSheet("v_spares_latest", "Spares Shops")}>
            {busy === "sync-v_spares_latest" ? "Syncing…" : "Sync spares to live sheet"}
          </Button>
        </div>
      {err && <p className="mt-3 font-semibold text-alert">{err}</p>}
      {syncMsg && <p className="mt-3 rounded-xl bg-amber-soft px-4 py-2 text-sm font-semibold text-ink">{syncMsg}</p>}

      {totals && (
        <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {([["People captured", totals.all], ["Today", totals.today], ["Last 7 days", totals.week], ["Registered", totals.registered], ["Have scanned", totals.adopters]] as const).map(([l, v]) => (
            <div key={l} className="rounded-2xl bg-card p-4"><dt className="text-sm text-muted">{l}</dt><dd className="font-display text-4xl font-bold">{v}</dd></div>
          ))}
        </dl>
      )}

      <section className="mt-6 rounded-2xl bg-card p-5">
        <h2 className="font-display text-2xl font-bold">Captures per day, last 30 days</h2>
        <DailyChart data={days} />
      </section>

      <section className="mt-6 overflow-x-auto rounded-2xl bg-card">
        <table className="w-full min-w-[820px] text-left">
          <caption className="p-5 text-left font-display text-2xl font-bold">Reps</caption>
          <thead className="border-y border-line text-sm text-muted">
            <tr>{["Rep", "Today", "7 days", "Mechanics", "Shops", "Total", "Registered", "Scanned", "Scans*", "Consent", "Last capture"].map((h, i) => <th key={h} className={"px-4 py-2 font-medium " + (i ? "text-right" : "")}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {reps?.map((r) => (
              <tr key={r.rep_id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link className="font-semibold underline" href={`/dashboard/reps/${r.rep_id}`}>{r.rep_name}</Link>{!r.active && <span className="ml-2 text-sm text-muted">(off)</span>}</td>
                <td className="px-4 text-right tabular-nums">{r.captured_today}</td>
                <td className="px-4 text-right tabular-nums">{r.captured_7d}</td>
                <td className="px-4 text-right tabular-nums">{r.mechanics_captured}</td>
                <td className="px-4 text-right tabular-nums">{r.shops_captured}</td>
                <td className="px-4 text-right font-bold tabular-nums">{r.people_captured}</td>
                <td className="px-4 text-right tabular-nums">{r.registered}</td>
                <td className="px-4 text-right tabular-nums">{r.adopters}</td>
                <td className="px-4 text-right tabular-nums">{r.total_scans}</td>
                <td className="px-4 text-right tabular-nums">{r.consent_rate_pct ?? "–"}{r.consent_rate_pct !== null && "%"}</td>
                <td className="px-4 text-right text-sm text-muted">{r.last_capture_at ? new Date(r.last_capture_at).toLocaleDateString("en-ZA") : "never"}</td>
              </tr>
            ))}
            {reps && reps.length === 0 && <tr><td colSpan={11} className="px-4 py-8 text-center text-muted">No reps yet. Create logins with scripts/create-users.mjs.</td></tr>}
          </tbody>
        </table>
        <p className="p-4 text-sm text-muted">*Scan numbers are typed in by reps, not read from the FastScan app, so treat them as self-reported.</p>
      </section>
    </Shell>
  );
}

export default function Page() { return <SessionGate managerOnly><Dash /></SessionGate>; }

"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";import { SessionGate } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { DailyChart, type Day } from "@/components/DailyChart";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui";
import { toXlsx, downloadXlsx } from "@/lib/xlsx";
import { toCsv, download as downloadCsv } from "@/lib/csv";
import { todayISO } from "@/lib/format";

type Rep = {
  rep_id: string; rep_name: string; role: string; active: boolean; mechanics_captured: number; shops_captured: number;
  people_captured: number; captured_today: number; captured_7d: number; captured_30d: number; registered: number; adopters: number;
  total_scans: number; consent_rate_pct: number | null; last_capture_at: string | null;
};

const sum = (a: Rep[], k: keyof Rep) => a.reduce((n, r) => n + Number(r[k] ?? 0), 0);
type SheetPreview = { mechanics: Record<string, unknown>[]; spares: Record<string, unknown>[] };
const cellText = (value: unknown) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

function PreviewTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{title} ({rows.length})</h3>
      {rows.length === 0 ? <p className="text-sm text-muted">No saved rows.</p> : (
        <div className="max-h-[24rem] overflow-auto rounded-xl border border-line">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="sticky top-0 bg-paper text-muted">
              <tr>{Object.keys(rows[0]).map((column) => <th key={column} className="whitespace-nowrap border-b border-line px-3 py-2 font-semibold">{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {Object.keys(rows[0]).map((column) => <td key={column} className="max-w-64 px-3 py-2 align-top">{cellText(row[column])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 10 && <p className="border-t border-line px-3 py-2 text-xs text-muted">Showing 10 of {rows.length} rows.</p>}
        </div>
      )}
    </div>
  );
}

function Dash() {
  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  const [reps, setReps] = useState<Rep[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [err, setErr] = useState("");
  const [sheetSyncMsg, setSheetSyncMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [sheetPreview, setSheetPreview] = useState<SheetPreview | null>(null);

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
    setBusy(view); setErr(""); setSheetPreview(null);
    const { data, error } = await supabase().from(view).select("*").limit(50000);
    setBusy("");
    if (error) return setErr(error.message);
    const rows = data as Record<string, unknown>[];
    downloadXlsx(`${label}-${todayISO()}.xlsx`, toXlsx(rows));
  }

  async function exportCsv(view: "v_mechanic_flat" | "v_spares_latest", label: string) {
    setBusy("csv-" + view); setErr(""); setSheetPreview(null);
    const { data, error } = await supabase().from(view).select("*").limit(50000);
    setBusy("");
    if (error) return setErr(error.message);
    downloadCsv(`${label}-${todayISO()}.csv`, toCsv(data as Record<string, unknown>[]));
  }

  async function previewSheet() {
    setBusy("preview-all"); setErr(""); setSheetPreview(null);
    const [mechanics, spares] = await Promise.all([
      supabase().from("v_mechanic_flat").select("*").limit(50000),
      supabase().from("v_spares_latest").select("*").limit(50000),
    ]);
    setBusy("");
    if (mechanics.error || spares.error) return setErr(mechanics.error?.message ?? spares.error?.message ?? "Could not load saved rows.");
    setSheetPreview({
      mechanics: mechanics.data as Record<string, unknown>[],
      spares: spares.data as Record<string, unknown>[],
    });
  }

  async function syncAllToLiveSheet(restoreMissing = false) {
    if (restoreMissing && !window.confirm("Restore records that were previously synced but are now missing from the sheet? This will add those rows back from Supabase.")) return;
    setBusy(restoreMissing ? "restore-missing" : "sync-all"); setErr(""); setSheetSyncMsg(""); setSheetPreview(null);
    try {
      const { data: { session } } = await supabase().auth.getSession();
      if (!session?.access_token) throw new Error("Your session has expired. Sign in again.");
      const response = await fetch("/api/sheets-sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ kind: "mechanic", restoreMissing }),
      });
      const result = await response.json() as { mechanicsSynced?: number; skippedCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Google Sheet sync failed.");
      const skipped = result.skippedCount ?? 0;
      setSheetSyncMsg(`Synced ${result.mechanicsSynced ?? 0} eligible mechanic(s) to WhatsApp Import.${skipped ? ` Skipped ${skipped} ineligible, duplicate, or previously removed record(s).` : ""}`);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not sync to the live Google Sheet.");
    } finally {
      setBusy("");
    }
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
        </div>
        <section className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-card p-4">
          <div>
            <h2 className="font-display text-xl font-bold">Google Sheets</h2>
            <p className="text-sm text-muted">Sync eligible mechanic records to the Quorum WhatsApp Import tab. Spares sync is not configured yet.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!busy} onClick={() => void syncAllToLiveSheet()}>
              {busy === "sync-all" ? "Syncing mechanic records..." : "Sync mechanics to WhatsApp Import"}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => void syncAllToLiveSheet(true)}>
              {busy === "restore-missing" ? "Restoring missing records..." : "Restore missing records"}
            </Button>
            {googleSheetUrl && <a
              href={googleSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-14 rounded-xl border-2 border-line bg-card px-6 text-lg font-semibold flex items-center hover:border-brand hover:bg-brand hover:text-white transition-all duration-150"
            >
              Open WhatsApp Import sheet
            </a>}
          </div>
          {sheetSyncMsg && <p className="w-full text-sm font-semibold text-brand">{sheetSyncMsg}</p>}
          <p className="w-full text-sm text-muted">Normal sync adds new records and updates rows that remain in the sheet. Rows you delete stay deleted; use “Restore missing records” only when you want them back.</p>
          <div className="w-full">
            <Button variant="ghost" disabled={!!busy} onClick={() => void previewSheet()}>
              {busy === "preview-all" ? "Loading saved records..." : "Preview saved records"}
            </Button>
          </div>
        </section>
      {err && <p className="mt-3 font-semibold text-alert">{err}</p>}

      {sheetPreview && (
        <section className="mt-4 space-y-3 rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-bold">Saved records preview</h2>
            <Button variant="ghost" onClick={() => setSheetPreview(null)}>Close preview</Button>
          </div>
          <p className="text-sm text-muted">Preview from Castrol FastScan's saved database; syncing to Google Sheets is a separate action.</p>
          <div className="grid gap-6 xl:grid-cols-2">
            <PreviewTable title="Mechanics" rows={sheetPreview.mechanics} />
            <PreviewTable title="Spares shops" rows={sheetPreview.spares} />
          </div>
        </section>
      )}

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
        <p className="p-4 text-sm text-muted">*Scan numbers are typed in by reps, not read from the Castrol FastScan app, so treat them as self-reported.</p>
      </section>
    </Shell>
  );
}

export default function Page() { return <SessionGate managerOnly><Dash /></SessionGate>; }

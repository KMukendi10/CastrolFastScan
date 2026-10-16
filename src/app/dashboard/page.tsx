"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";import { SessionGate } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { DailyChart, type Day } from "@/components/DailyChart";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui";
import { toWorkbookXlsx, downloadXlsx } from "@/lib/xlsx";
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
  const googleSheetUrl = "https://docs.google.com/spreadsheets/d/1KosBOc_PhucddXW8bvAe1Cc3C48S-kEJirKXoFT6nGY/edit";
  const [reps, setReps] = useState<Rep[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [err, setErr] = useState("");
  const [sheetSyncMsg, setSheetSyncMsg] = useState("");
  const [sheetSyncDestination, setSheetSyncDestination] = useState<{ name: string; url: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [sheetPreview, setSheetPreview] = useState<SheetPreview | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

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

  async function exportWorkbook() {
    setBusy("export-workbook"); setErr(""); setSheetPreview(null);
    const [mechanics, spares] = await Promise.all([
      supabase().from("v_mechanic_flat").select("*").limit(50000),
      supabase().from("v_spares_latest").select("*").limit(50000),
    ]);
    setBusy("");
    if (mechanics.error || spares.error) return setErr(mechanics.error?.message ?? spares.error?.message ?? "Could not export records.");
    const workbook = toWorkbookXlsx([
      { name: "Mechanics", rows: mechanics.data as Record<string, unknown>[] },
      { name: "Spares shops", rows: spares.data as Record<string, unknown>[] },
    ]);
    downloadXlsx(`castrol-fastscan-${todayISO()}.xlsx`, workbook);
  }

  async function exportCsvFile() {
    setBusy("export-csv"); setErr(""); setSheetPreview(null);
    const [mechanics, spares] = await Promise.all([
      supabase().from("v_mechanic_flat").select("*").limit(50000),
      supabase().from("v_spares_latest").select("*").limit(50000),
    ]);
    setBusy("");
    if (mechanics.error || spares.error) return setErr(mechanics.error?.message ?? spares.error?.message ?? "Could not export records.");

    const mechanicRows = (mechanics.data ?? []) as Record<string, unknown>[];
    const sparesRows = (spares.data ?? []) as Record<string, unknown>[];
    const columns = ["Record type", ...new Set([...mechanicRows, ...sparesRows].flatMap((row) => Object.keys(row)))];
    const combinedRows: Record<string, unknown>[] = [
      ...mechanicRows.map((row) => ({ ...row, "Record type": "Mechanic" })),
      ...sparesRows.map((row) => ({ ...row, "Record type": "Spares shop" })),
    ];
    const rows = combinedRows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
    downloadCsv(`castrol-fastscan-${todayISO()}.csv`, toCsv(rows));
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
    setBusy(restoreMissing ? "restore-missing" : "sync-all"); setErr(""); setSheetSyncMsg(""); setSheetSyncDestination(null); setSheetPreview(null);
    setConfirmRestore(false);
    try {
      const { data: { session } } = await supabase().auth.getSession();
      if (!session?.access_token) throw new Error("Your session has expired. Sign in again.");
      const response = await fetch("/api/sheets-sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ kind: "mechanic", restoreMissing }),
      });
      const result = await response.json() as {
        mechanicsSynced?: number;
        skippedCount?: number;
        tab?: string;
        spreadsheetName?: string;
        spreadsheetUrl?: string;
        writtenRows?: number[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Google Sheet sync failed.");
      const synced = result.mechanicsSynced ?? 0;
      setSheetSyncMsg(synced === 0
        ? restoreMissing ? "Nothing to restore. The sheet is up to date." : "Nothing new to sync. The sheet is up to date."
        : `${synced} record${synced === 1 ? "" : "s"} synced to the sheet.`);
      if (result.spreadsheetName && result.spreadsheetUrl) {
        setSheetSyncDestination({ name: result.spreadsheetName, url: result.spreadsheetUrl });
      }
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
        <Button variant="ghost" disabled={!!busy} onClick={() => void exportWorkbook()}>
          {busy === "export-workbook" ? "Preparing…" : "Download Excel"}
        </Button>
        <Button variant="ghost" disabled={!!busy} onClick={() => void exportCsvFile()}>
          {busy === "export-csv" ? "Preparing…" : "Download CSV"}
        </Button>
      </div>
        <section className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-card p-4">
          <div>
            <h2 className="font-display text-xl font-bold">Google Sheets</h2>
            <p className="text-sm text-muted">Sync the sheet with new records.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!busy} onClick={() => void syncAllToLiveSheet()}>
              {busy === "sync-all" ? "Syncing..." : "Sync sheet"}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmRestore(true)}>
              {busy === "restore-missing" ? "Restoring..." : "Restore records"}
            </Button>
            <a
              href={googleSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-14 rounded-xl border-2 border-line bg-card px-6 text-lg font-semibold flex items-center hover:border-brand hover:bg-brand hover:text-white transition-all duration-150"
            >
              Open live sheet
            </a>
          </div>
          {confirmRestore && (
            <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-line bg-paper p-3" role="group" aria-label="Confirm restore">
              <p className="mr-auto font-semibold">Restore missing rows?</p>
              <Button variant="ghost" onClick={() => setConfirmRestore(false)}>Cancel</Button>
              <Button onClick={() => void syncAllToLiveSheet(true)}>Restore</Button>
            </div>
          )}
          {sheetSyncMsg && <p className="w-full text-sm font-semibold text-brand">{sheetSyncMsg}</p>}
          {sheetSyncDestination && (
            <p className="w-full text-sm">
              Sync destination: <a className="font-semibold underline" href={sheetSyncDestination.url} target="_blank" rel="noopener noreferrer">Open {sheetSyncDestination.name}</a>
            </p>
          )}
          <p className="w-full text-sm text-muted">Deleted rows stay deleted unless you restore them.</p>
          <div className="w-full">
            <Button variant="ghost" disabled={!!busy} onClick={() => void previewSheet()}>
              {busy === "preview-all" ? "Loading..." : "Preview records"}
            </Button>
          </div>
        </section>
      {err && <p className="mt-3 font-semibold text-alert">{err}</p>}

      {sheetPreview && (
        <section className="mt-4 space-y-3 rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-bold">Saved records preview</h2>
            <Button variant="ghost" onClick={() => setSheetPreview(null)}>Close</Button>
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

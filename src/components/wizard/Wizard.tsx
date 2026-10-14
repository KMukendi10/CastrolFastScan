"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useLookups } from "@/lib/lookups";
import { uuid } from "@/lib/format";
import { Banner, Button } from "@/components/ui";
import type { Flow, Errors } from "./types";

type Draft<S> = { id: string; step: number; s: S };
type Completion = { duplicate: boolean; sheetSync: "syncing" | "synced" | "skipped" | "not-configured" | "failed"; sheetMessage?: string; recordId?: number };

/** Runs a flow: client steps (amber) then rep steps (green). The draft lives in
 *  localStorage so a refresh or a dead battery does not lose the answers, and the
 *  submission id is stable so a retry can never save twice. */
export function Wizard<S>({ flow, draftKey, label }: { flow: Flow<S>; draftKey: string; label: string }) {
  const { lookups, error: lkError } = useLookups();
  const [draft, setDraft] = useState<Draft<S> | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const [done, setDone] = useState<Completion | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let d: Draft<S> | null = null;
    try { d = JSON.parse(localStorage.getItem(draftKey) ?? "null"); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the saved draft once on mount
    setDraft(d ?? { id: uuid(), step: 0, s: flow.initial() });
  }, [draftKey, flow]);

  useEffect(() => {
    if (!draft || done) return;
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* storage full or blocked */ }
  }, [draft, draftKey, done]);

  const steps = flow.steps;
  const step = draft ? steps[Math.min(draft.step, steps.length - 1)] : null;
  const isLast = !!draft && draft.step === steps.length - 1;
  const clientMode = step?.who === "client";

  const ctx = useMemo(() => (draft && lookups ? {
    s: draft.s, e: errors, lk: lookups, submissionId: draft.id,
    set: (patch: Partial<S>) => setDraft((d) => (d ? { ...d, s: { ...d.s, ...patch } } : d)),
  } : null), [draft, lookups, errors]);

  if (lkError) return <div className="p-5"><Banner tone="error">Could not load the lists ({lkError}). Check your signal and refresh.</Banner></div>;
  if (!draft || !step || !ctx) return <p className="p-5 text-muted">Loading…</p>;

  if (done) return (
    <div className="mx-auto max-w-lg space-y-5 px-5 py-10 text-center">
      <div className="mx-auto grid size-20 place-items-center rounded-full bg-brand text-4xl text-white">✓</div>
      <h1 className="font-display text-4xl font-bold">{done.duplicate ? "Already saved" : "Saved"}</h1>
      <p className="text-lg text-muted">{label} is recorded under your name.</p>
      {done.sheetSync === "syncing" && <p className="text-sm text-muted">Adding this registration to the Google Sheet…</p>}
      {done.sheetSync === "synced" && <p className="text-sm font-semibold text-brand">This registration was also added to the Google Sheet.</p>}
      {done.sheetSync === "skipped" && <p className="text-sm text-muted">This registration was left out of the Google Sheet because its row was previously deleted.</p>}
      {done.sheetSync === "not-configured" && <p className="text-sm text-muted">Google Sheet sync is not set up yet. This registration is saved in FastScan.</p>}
      {done.sheetSync === "failed" && (
        <div className="space-y-2">
          <p className="text-sm text-alert">Saved in FastScan, but the Google Sheet sync failed{done.sheetMessage ? `: ${done.sheetMessage}` : "."}</p>
          {done.recordId && <Button variant="ghost" onClick={() => void syncSavedRecord(done.recordId!)}>Retry Google Sheet sync</Button>}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button onClick={() => { setDone(null); setFail(""); setErrors({}); setDraft({ id: uuid(), step: 0, s: flow.initial() }); top.current?.scrollIntoView(); }}>Capture another</Button>
        <Link href="/" className="grid min-h-14 place-items-center rounded-xl border-2 border-line bg-card px-6 text-lg font-semibold">Back to home</Link>
      </div>
    </div>
  );

  function go(n: number) {
    setErrors({});
    setDraft((d) => (d ? { ...d, step: n } : d));
    window.scrollTo({ top: 0 });
  }

  async function syncSavedRecord(recordId: number) {
    setDone((current) => current ? { ...current, sheetSync: "syncing", sheetMessage: undefined } : current);
    try {
      const { data: { session } } = await supabase().auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again before retrying the sync.");
      const response = await fetch("/api/sheets-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ kind: flow.rpc === "submit_onboarding" ? "mechanic" : "spares", recordId }),
      });
      const result = await response.json() as { synced?: boolean; skipped?: boolean; configured?: boolean; error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Google Sheets sync failed.");
      if (!result.configured) {
        setDone((current) => current ? { ...current, sheetSync: "not-configured", sheetMessage: result.message } : current);
        return;
      }
      setDone((current) => current ? { ...current, sheetSync: result.skipped ? "skipped" : result.synced ? "synced" : "failed", sheetMessage: result.error } : current);
    } catch (error) {
      setDone((current) => current ? { ...current, sheetSync: "failed", sheetMessage: error instanceof Error ? error.message : "Google Sheets sync failed." } : current);
    }
  }

  async function next() {
    // Let reps preview every page without completing earlier pages. Validate
    // the complete draft only when they try to save on the final page.
    if (!isLast) return go(draft!.step + 1);

    for (let i = 0; i < steps.length; i++) {
      const e = steps[i].validate(draft!.s);
      if (Object.keys(e).length) {
        setErrors(e);
        setDraft((d) => (d ? { ...d, step: i } : d));
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }

    setBusy(true); setFail("");
    try {
      const { data, error } = await supabase().rpc(flow.rpc, { payload: flow.toPayload(draft!.s, draft!.id) });
      if (error) {
        if (error.code === "FS409" || error.code === "FS422") setFail(error.message.replace(/^[A-Z_]+:\s*/, ""));
        else if (error.code === "42501") setFail("Your session has ended or your account is off. Sign in again.");
        else if (error.message?.includes("Failed to fetch")) setFail("No signal. Your answers are kept on this tablet. Try again when you are back online.");
        else setFail("Could not save: " + error.message);
        return;
      }
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      const saved = data as { duplicate?: boolean; mechanic_id?: number; shop_id?: number };
      const recordId = flow.rpc === "submit_onboarding" ? saved?.mechanic_id : saved?.shop_id;
      setDone({ duplicate: !!saved?.duplicate, sheetSync: "not-configured", recordId });
      if (recordId) void syncSavedRecord(recordId);
    } catch {
      setFail("No signal. Your answers are kept on this tablet. Try again when you are back online.");
    } finally { setBusy(false); }
  }

  return (
    <div ref={top}>
      <div className={"px-5 py-3 " + (clientMode ? "bg-paper border-b border-line text-ink" : "bg-brand text-white")}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <span className="font-display text-xl font-bold">{clientMode ? "Client fills this in" : "Rep only"}</span>
          <span className="text-base font-medium">Step {draft.step + 1} of {steps.length}</span>
        </div>
      </div>
      <div className={"px-5 py-6 " + (clientMode ? "bg-card" : "")}>
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="font-display text-4xl font-bold">{step.title}</h1>
            {step.intro && <p className="mt-1 text-lg text-muted">{step.intro}</p>}
          </div>
          {Object.keys(errors).length > 0 && <Banner tone="error">Fix the marked fields to continue.</Banner>}
          {fail && <Banner tone="error">{fail}</Banner>}
          {step.render(ctx)}
          <div className="flex flex-wrap justify-between gap-3 pt-2">
            {draft.step > 0 ? <Button variant="ghost" onClick={() => go(draft.step - 1)}>Back</Button> : <span />}
            <Button onClick={next} disabled={busy}>{busy ? "Saving…" : isLast ? "Save" : "Next"}</Button>
          </div>
          {draft.step === 0 && (
            <button className="text-base text-muted underline" onClick={() => { if (confirm("Throw away what you typed?")) { try { localStorage.removeItem(draftKey); } catch {} setErrors({}); setDraft({ id: uuid(), step: 0, s: flow.initial() }); } }}>Clear form</button>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { RecordView } from "./Record";
import { StatusEditor } from "./StatusEditor";
import { Button } from "./ui";

type Row = Record<string, unknown>;

export function ClientDetail({ kind, id, editable }: { kind: "mechanic" | "spares"; id: number; editable: boolean }) {
  const router = useRouter();
  const [row, setRow] = useState<Row | null>(null);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const view = kind === "mechanic" ? "v_mechanic_flat" : "v_spares_latest";
    const key = kind === "mechanic" ? "mechanic_id" : "shop_id";
    const { data, error } = await supabase().from(view).select("*").eq(key, id).maybeSingle();
    if (error) return setErr(error.message);
    if (!data) return setErr("Not found, or it belongs to another rep.");
    setRow(data as Row);
    if (kind === "mechanic") setConsent(!!(data as Row)["POPIA consent"]);
  }, [kind, id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { load(); }, [load]);

  if (!row) return err ? <p className="font-semibold text-alert">{err}</p> : <p className="text-muted">Loading…</p>;
  const title = kind === "mechanic" ? `${row["First name"]} ${row["Surname"]}` : String(row["Spare shop trading name"]);

  async function deleteRegistration() {
    if (!window.confirm(`Delete ${title}'s registration? It will be removed from active app records${kind === "mechanic" ? " and WhatsApp Import" : ""}.`)) return;
    setDeleting(true);
    setErr("");
    const { data: { session } } = await supabase().auth.getSession();
    if (!session) {
      setDeleting(false);
      setErr("Your session has expired. Sign in again before deleting this registration.");
      return;
    }
    const response = await fetch(`/api/registrations/${kind}/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json().catch(() => null) as { deleted?: boolean; message?: string; error?: string } | null;
    setDeleting(false);
    if (!response.ok || !result?.deleted) {
      setErr(result?.error ?? "Could not delete this registration.");
      return;
    }
    if (result.message) window.alert(result.message);
    router.replace("/clients");
    router.refresh();
  }
  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-bold">{title}</h1>
      {err && <p role="alert" className="font-semibold text-alert">{err}</p>}
      <div className="rounded-2xl bg-card p-5"><RecordView row={row} /></div>
      {kind === "mechanic" && editable && (
        <StatusEditor key={JSON.stringify([row["FastScan registered"], row["Total scans"], consent])} mechanicId={id} consent={consent} onSaved={load}
          init={{ registered: !!row["FastScan registered"], first_scan: !!row["First scan completed (agent)"], total_scans: Number(row["Total scans"] ?? 0),
                  kit: (row["Service kit distributed"] as boolean | null) ?? null, incentive: (row["Incentive distributed"] as boolean | null) ?? null }} />
      )}
      {kind === "spares" && editable && (
        <Link href="/capture/spares" className="grid min-h-14 place-items-center rounded-xl bg-brand text-lg font-semibold text-white">Log a new visit</Link>
      )}
      {editable && (
        <section className="space-y-3 rounded-2xl border-2 border-alert/30 bg-card p-5">
          <h2 className="font-display text-xl font-bold">Remove this registration</h2>
          <p className="text-muted">The registration will disappear from active records. Its consent history is retained for audit purposes.</p>
          <Button variant="danger" disabled={deleting} onClick={deleteRegistration}>
            {deleting ? "Deleting…" : "Delete registration"}
          </Button>
        </section>
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { RecordView } from "./Record";
import { StatusEditor } from "./StatusEditor";

type Row = Record<string, unknown>;

export function ClientDetail({ kind, id, editable }: { kind: "mechanic" | "spares"; id: number; editable: boolean }) {
  const [row, setRow] = useState<Row | null>(null);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState("");

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

  if (err) return <p className="font-semibold text-alert">{err}</p>;
  if (!row) return <p className="text-muted">Loading…</p>;
  const title = kind === "mechanic" ? `${row["First name"]} ${row["Surname"]}` : String(row["Spare shop trading name"]);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-bold">{title}</h1>
      <div className="rounded-2xl bg-card p-5"><RecordView row={row} /></div>
      {kind === "mechanic" && editable && (
        <StatusEditor key={JSON.stringify([row["FastScan registered"], row["Total scans"], consent])} mechanicId={id} consent={consent} onSaved={load}
          init={{ registered: !!row["FastScan registered"], first_scan: !!row["First scan completed (agent)"], total_scans: Number(row["Total scans"] ?? 0),
                  kit: (row["Service kit distributed"] as boolean | null) ?? null, incentive: (row["Incentive distributed"] as boolean | null) ?? null }} />
      )}
      {kind === "spares" && editable && (
        <Link href="/capture/spares" className="grid min-h-14 place-items-center rounded-xl bg-brand text-lg font-semibold text-white">Log a new visit</Link>
      )}
    </div>
  );
}

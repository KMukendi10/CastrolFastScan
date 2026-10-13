"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SessionGate } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui";
import { download, toCsv } from "@/lib/csv";

type M = { mechanic_id: number; Date: string; "First name": string; Surname: string; "Contact number": string; "Workshop name": string; "FastScan registered": boolean | null; "Total scans": number | null };
type S = { shop_id: number; "Spare shop trading name": string; "Manager name": string; "Manager surname": string; "Contact number": string | null; "Date of latest visit": string | null };

export function Drill({ id }: { id: string }) {
  const [name, setName] = useState("");
  const [mech, setMech] = useState<M[]>([]);
  const [shops, setShops] = useState<S[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase().from("profiles").select("full_name").eq("id", id).maybeSingle().then(({ data }) => setName(data?.full_name ?? ""));
    supabase().from("v_mechanic_flat").select('mechanic_id, "Date", "First name", "Surname", "Contact number", "Workshop name", "FastScan registered", "Total scans"').eq("captured_by_user", id).order("mechanic_id", { ascending: false })
      .then(({ data, error }) => error ? setErr(error.message) : setMech(data as unknown as M[]));
    supabase().from("v_spares_latest").select('shop_id, "Spare shop trading name", "Manager name", "Manager surname", "Contact number", "Date of latest visit"').eq("captured_by_user", id).order("shop_id", { ascending: false })
      .then(({ data, error }) => error ? setErr(error.message) : setShops(data as unknown as S[]));
  }, [id]);

  async function exportRep() {
    const [a, b] = await Promise.all([
      supabase().from("v_mechanic_flat").select("*").eq("captured_by_user", id),
      supabase().from("v_spares_latest").select("*").eq("captured_by_user", id),
    ]);
    download(`${name || "rep"}-mechanics.csv`, toCsv((a.data ?? []) as Record<string, unknown>[]));
    download(`${name || "rep"}-spares.csv`, toCsv((b.data ?? []) as Record<string, unknown>[]));
  }

  return (
    <Shell back="/dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl font-bold">{name || "Rep"}</h1>
        <Button variant="ghost" onClick={exportRep}>Download this rep (CSV)</Button>
      </div>
      {err && <p className="mt-3 font-semibold text-alert">{err}</p>}
      <h2 className="mt-8 font-display text-2xl font-bold">Mechanics ({mech.length})</h2>
      <ul className="mt-2 divide-y divide-line rounded-2xl bg-card">
        {mech.map((m) => (
          <li key={m.mechanic_id}><Link href={`/clients/mechanic/${m.mechanic_id}`} className="flex min-h-16 items-center justify-between gap-4 px-5 py-3">
            <span><b>{m["First name"]} {m.Surname}</b> · {m["Contact number"]}<br /><span className="text-muted">{m["Workshop name"]} · captured {m.Date}</span></span>
            <span className="text-sm font-semibold">{m["FastScan registered"] ? `Registered · ${m["Total scans"] ?? 0} scans` : "Not registered"}</span>
          </Link></li>
        ))}
        {mech.length === 0 && <li className="px-5 py-6 text-muted">None yet.</li>}
      </ul>
      <h2 className="mt-8 font-display text-2xl font-bold">Spares shops ({shops.length})</h2>
      <ul className="mt-2 divide-y divide-line rounded-2xl bg-card">
        {shops.map((s) => (
          <li key={s.shop_id}><Link href={`/clients/spares/${s.shop_id}`} className="flex min-h-16 items-center justify-between gap-4 px-5 py-3">
            <span><b>{s["Spare shop trading name"]}</b><br /><span className="text-muted">{s["Manager name"]} {s["Manager surname"]} · {s["Contact number"] ?? "no number"}</span></span>
            <span className="text-muted">Last visit {s["Date of latest visit"] ?? "none"}</span>
          </Link></li>
        ))}
        {shops.length === 0 && <li className="px-5 py-6 text-muted">None yet.</li>}
      </ul>
    </Shell>
  );
}


export function DrillClient({ id }: { id: string }) {
  return <SessionGate managerOnly><Drill id={id} /></SessionGate>;
}

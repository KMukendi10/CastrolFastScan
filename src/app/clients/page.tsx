"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SessionGate } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { supabase } from "@/lib/supabase";
import { TextInput } from "@/components/ui";

type M = { mechanic_id: number; database_kind: string; Date: string; "First name": string; Surname: string; "Workshop name": string; "FastScan registered": boolean | null; "Total scans": number | null };
type S = { shop_id: number; "Spare shop trading name": string; "Manager name": string; "Manager surname": string; "Date of latest visit": string | null; Area: string | null };

function List() {
  const [tab, setTab] = useState<"mechanic" | "spares">("mechanic");
  const [mech, setMech] = useState<M[] | null>(null);
  const [shops, setShops] = useState<S[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase().from("v_mechanic_flat").select('mechanic_id, database_kind, "First name", "Surname", "Workshop name", "FastScan registered", "Total scans"')
      .order("mechanic_id", { ascending: false }).limit(500)
      .then(({ data, error }) => { if (error) setErr(error.message); else setMech(data as unknown as M[]); });
    supabase().from("v_spares_latest").select('shop_id, "Spare shop trading name", "Manager name", "Manager surname", "Date of latest visit", "Area"')
      .order("shop_id", { ascending: false }).limit(500)
      .then(({ data, error }) => { if (error) setErr(error.message); else setShops(data as unknown as S[]); });
  }, []);

  const needle = q.trim().toLowerCase();
  const mf = useMemo(() => (mech ?? []).filter((m) => !needle || `${m["First name"]} ${m.Surname} ${m["Workshop name"]}`.toLowerCase().includes(needle)), [mech, needle]);
  const sf = useMemo(() => (shops ?? []).filter((s) => !needle || `${s["Spare shop trading name"]} ${s["Manager name"]} ${s["Manager surname"]}`.toLowerCase().includes(needle)), [shops, needle]);

  return (
    <Shell back="/" title="My clients">
      <div className="mb-4 flex flex-wrap gap-3">
        {(["mechanic", "spares"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
            className={"min-h-14 rounded-xl border-2 px-6 text-lg font-semibold " + (tab === t ? "border-brand bg-brand text-white" : "border-line bg-card")}>
            {t === "mechanic" ? `Mechanics (${mech?.length ?? "…"})` : `Spares shops (${shops?.length ?? "…"})`}
          </button>
        ))}
        <div className="min-w-60 flex-1"><TextInput placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {err && <p className="font-semibold text-alert">{err}</p>}
      <ul className="divide-y divide-line rounded-2xl bg-card">
        {tab === "mechanic" && mf.map((m) => (
          <li key={m.mechanic_id}><Link href={`/clients/mechanic/${m.mechanic_id}`} className="flex min-h-16 items-center justify-between gap-4 px-5 py-3">
            <span><b>{m["First name"]} {m.Surname}</b><br /><span className="text-muted">{m["Workshop name"]} · {m.database_kind === "mechanics_profile" ? "Profile" : "Independent"}</span></span>
            <span className={"rounded-full px-3 py-1 text-sm font-semibold " + (m["FastScan registered"] ? "bg-green-100 text-deep" : "bg-amber-soft")}>{m["FastScan registered"] ? `Registered · ${m["Total scans"] ?? 0} scans` : "Not registered"}</span>
          </Link></li>
        ))}
        {tab === "spares" && sf.map((s) => (
          <li key={s.shop_id}><Link href={`/clients/spares/${s.shop_id}`} className="flex min-h-16 items-center justify-between gap-4 px-5 py-3">
            <span><b>{s["Spare shop trading name"]}</b><br /><span className="text-muted">{s["Manager name"]} {s["Manager surname"]}{s.Area ? ` · ${s.Area}` : ""}</span></span>
            <span className="text-muted">Last visit {s["Date of latest visit"] ?? "none"}</span>
          </Link></li>
        ))}
        {((tab === "mechanic" && mech && mf.length === 0) || (tab === "spares" && shops && sf.length === 0)) && (
          <li className="px-5 py-8 text-center text-muted">{needle ? "No match. Try fewer letters." : "Nothing here yet. Start a capture from the home screen."}</li>
        )}
      </ul>
    </Shell>
  );
}
export default function Page() { return <SessionGate><List /></SessionGate>; }

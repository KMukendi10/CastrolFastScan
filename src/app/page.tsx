"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SessionGate, useProfile } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { supabase } from "@/lib/supabase";

type Perf = { captured_today: number; captured_7d: number; people_captured: number };

function Home() {
  const p = useProfile();
  const router = useRouter();
  const [perf, setPerf] = useState<Perf | null>(null);

  useEffect(() => {
    supabase().from("v_rep_performance").select("captured_today, captured_7d, people_captured").eq("rep_id", p.id).single()
      .then(({ data }) => setPerf(data as Perf | null));
  }, [p]);

  useEffect(() => {
    // Returning to the home screen ends any unfinished capture. A later capture
    // starts with a clean form instead of restoring the previous client's data.
    for (const kind of ["mechanics_profile", "independent_mechanic", "spares"]) {
      try { localStorage.removeItem(`draft:${p.id}:${kind}`); } catch { /* storage unavailable */ }
    }
  }, [p.id]);

  const tiles: { href: string; title: string; sub: string }[] = [
    { href: "/capture/mechanics_profile", title: "Mechanic profile", sub: "Mechanic at a workshop or dealer" },
    { href: "/capture/independent_mechanic", title: "Independent mechanic", sub: "Own workshop, yard or home garage" },
    { href: "/capture/spares", title: "Spares shop", sub: "Visit and shelf audit" },
  ];

  return (
    <Shell>
      <h1 className="font-display text-4xl font-bold">Hi {p.full_name.split(" ")[0]}</h1>
      <p className="mt-1 text-lg text-muted">
        {perf ? <>You have captured <b className="text-ink">{perf.captured_today}</b> today, <b className="text-ink">{perf.captured_7d}</b> in the last 7 days, <b className="text-ink">{perf.people_captured}</b> in total.</> : "Loading your numbers…"}
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            onClick={(event) => {
              event.preventDefault();
              const kind = t.href.slice("/capture/".length);
              try { localStorage.removeItem(`draft:${p.id}:${kind}`); } catch { /* storage unavailable */ }
              router.push(`${t.href}?fresh=${Date.now()}`);
            }}
            className="block rounded-2xl bg-brand p-6 text-white active:brightness-90"
          >
            <span className="block font-display text-3xl font-bold">{t.title}</span>
            <span className="mt-1 block text-white/80">{t.sub}</span>
            <span className="mt-6 inline-block rounded-lg bg-white/15 px-4 py-2 font-semibold">Start capture</span>
          </Link>
        ))}
      </div>
      <Link href="/clients" className="mt-6 grid min-h-14 place-items-center rounded-xl border-2 border-line bg-card text-lg font-semibold">My clients</Link>
    </Shell>
  );
}

export default function Page() { return <SessionGate repOnly><Home /></SessionGate>; }

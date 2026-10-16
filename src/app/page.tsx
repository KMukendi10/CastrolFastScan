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
    { href: "/capture/mechanics_profile", title: "Mechanic profile", sub: "Workshop, dealer or independent mechanic" },
    { href: "/capture/spares", title: "Spares shop", sub: "Visit and shelf audit" },
  ];

  return (
    <Shell>
      <section className="rounded-3xl border border-line bg-card p-5 shadow-sm sm:p-7">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand">Rep workspace</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Hi {p.full_name.split(" ")[0]}</h1>
        <p className="mt-2 text-base leading-relaxed text-muted sm:text-lg">
          {perf ? <>You have captured <b className="text-ink">{perf.captured_today}</b> today, <b className="text-ink">{perf.captured_7d}</b> in the last 7 days, and <b className="text-ink">{perf.people_captured}</b> in total.</> : "Loading your numbers…"}
        </p>
      </section>
      <div className="mb-3 mt-8">
        <h2 className="font-display text-2xl font-extrabold">Start a capture</h2>
        <p className="mt-1 text-muted">Choose the type of contact you are visiting.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
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
            className="group flex min-h-52 flex-col rounded-2xl border border-brand/20 bg-brand p-5 text-white shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:brightness-95 focus-visible:outline-white sm:p-6"
          >
            <span className="block font-display text-2xl font-extrabold leading-tight sm:text-3xl">{t.title}</span>
            <span className="mt-2 block text-sm leading-relaxed text-white/85 sm:text-base">{t.sub}</span>
            <span className="mt-auto inline-flex min-h-11 items-center gap-2 pt-5 font-bold">Start capture <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span></span>
          </Link>
        ))}
      </div>
      <Link href="/clients" className="mt-5 flex min-h-14 items-center justify-between rounded-xl border-2 border-line bg-card px-5 text-base font-bold transition-colors hover:border-brand hover:text-brand sm:text-lg">
        <span>My clients</span><span aria-hidden="true">→</span>
      </Link>
    </Shell>
  );
}

export default function Page() { return <SessionGate repOnly><Home /></SessionGate>; }

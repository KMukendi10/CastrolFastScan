"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/session";

export function Shell({ children, title, back, bleed }: { children: React.ReactNode; title?: string; back?: string; bleed?: boolean }) {
  const p = useProfile();
  const router = useRouter();

  async function signOut() {
    await supabase().auth.signOut();
    router.replace(p.role === "manager" ? "/manager/login" : "/login");
  }

  return (
    <div className="min-h-screen">
      {/* Castrol red accent stripe */}
      <div style={{ backgroundColor: "#E2001A" }} className="h-1" />
      <header style={{ backgroundColor: "#008443" }} className="text-white shadow-sm">
        <div className="mx-auto flex min-h-[4.25rem] max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
          {back ? <Link href={back} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-2xl transition-colors hover:bg-white/10 focus-visible:outline-white" aria-label="Back">‹</Link> : null}
          <div className="min-w-0">
            <Link href="/" className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">
              Castrol <span className="text-accent">FastScan</span>
            </Link>
            {title && <span className="hidden pl-3 text-sm text-white/75 md:inline">{title}</span>}
          </div>
          <nav aria-label="Account" className="ml-auto flex min-h-11 items-center gap-1 sm:gap-2">
            <span className="hidden max-w-40 truncate px-2 text-sm text-white/80 sm:block">{p.full_name}</span>
            {p.role === "manager" && <Link href="/dashboard" className="flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-white/10">Dashboard</Link>}
            <button className="flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-white/10" onClick={signOut}>Sign out</button>
          </nav>
        </div>
      </header>
      <main className={bleed ? "" : "mx-auto max-w-5xl px-5 py-6"}>{children}</main>
    </div>
  );
}

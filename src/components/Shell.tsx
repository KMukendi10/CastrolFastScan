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
      <header style={{ backgroundColor: "#008443" }} className="text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3">
          {back ? <Link href={back} className="grid min-h-12 min-w-12 place-items-center rounded-lg text-2xl" aria-label="Back">‹</Link> : null}
          <Link href="/" className="font-display text-2xl font-bold tracking-wide">
            FastScan <span className="text-accent">Field</span>
          </Link>
          {title && <span className="hidden text-lg text-white/70 sm:inline">{title}</span>}
          <span className="ml-auto text-base text-white/80">{p.full_name}</span>
          {p.role === "manager" && <Link href="/dashboard" className="rounded-lg px-3 py-2 text-base underline hover:text-white/70 transition-colors duration-150">Dashboard</Link>}
          <button className="rounded-lg px-3 py-2 text-base underline hover:text-white/70 transition-colors duration-150" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className={bleed ? "" : "mx-auto max-w-5xl px-5 py-6"}>{children}</main>
    </div>
  );
}

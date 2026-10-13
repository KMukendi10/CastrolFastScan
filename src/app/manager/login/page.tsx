"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Banner, Button, Field, TextInput } from "@/components/ui";

export default function ManagerLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase().auth.getUser();
      if (u.user) {
        const { data } = await supabase().from("profiles").select("role").eq("id", u.user.id).single();
        if (data?.role === "manager") { router.replace("/dashboard"); return; }
        if (data?.role === "rep") { router.replace("/login"); return; }
      }
      setChecking(false);
    })();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setBusy(false); return setErr("Email or password is wrong. Check both and try again."); }
    const { data: u } = await supabase().auth.getUser();
    if (u.user) {
      const { data } = await supabase().from("profiles").select("role").eq("id", u.user.id).single();
      if (data?.role !== "manager") {
        await supabase().auth.signOut();
        setBusy(false);
        return setErr("This portal is for managers only. Use the rep sign-in page.");
      }
    }
    setBusy(false);
    router.replace("/dashboard");
    router.refresh();
  }

  if (checking) return <main className="p-8 text-muted">Loading…</main>;

  return (
    <main className="min-h-screen md:grid md:grid-cols-[1.1fr_1fr]">
      {/* Left — Castrol green hero panel */}
      <section className="relative hidden overflow-hidden bg-brand md:flex md:flex-col md:justify-between p-12">
        {/* Decorative red circle */}
        <div className="absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-accent opacity-20" />
        {/* Logo area */}
        <div>
          <span className="font-display text-3xl font-bold text-white tracking-wide">
            Castrol <span className="text-accent">FastScan</span>
          </span>
          <span className="ml-3 rounded-md bg-white/20 px-2 py-0.5 text-sm font-semibold text-white">Field</span>
        </div>
        {/* Hero copy */}
        <div className="relative z-10">
          <h1 className="font-display text-7xl font-bold leading-[0.95] text-white">
            Track.<br />Review.<br />Export.
          </h1>
          <p className="mt-6 max-w-sm text-lg text-white/80">
            See every rep's performance, download captures as Excel, and keep your live sheet up to date.
          </p>
        </div>
      </section>

      {/* Right — white form panel */}
      <section className="flex min-h-screen flex-col justify-center bg-white px-8 py-12">
        {/* Mobile logo */}
        <div className="mb-8 md:hidden">
          <span className="font-display text-2xl font-bold text-brand tracking-wide">
            Castrol <span className="text-accent">FastScan</span> Field
          </span>
        </div>
        <form onSubmit={submit} className="mx-auto w-full max-w-sm space-y-5">
          {/* Top accent bar */}
          <div className="h-1 w-12 rounded-full bg-accent" />
          <p className="text-sm font-bold uppercase tracking-widest text-muted">Manager portal</p>
          <h2 className="font-display text-4xl font-bold text-ink">Sign in</h2>
          {err && <Banner tone="error">{err}</Banner>}
          <Field label="Email">
            <TextInput type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <TextInput type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-sm text-muted">
            Are you a rep?{" "}
            <Link href="/login" className="font-semibold text-brand underline hover:text-brand-mid transition-colors duration-150">Rep sign in →</Link>
          </p>
        </form>
      </section>
    </main>
  );
}

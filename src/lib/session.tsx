"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";

export type Profile = { id: string; full_name: string; role: "rep" | "manager"; active: boolean };
const Ctx = createContext<Profile | null>(null);
export const useProfile = () => useContext(Ctx)!;

/** Loads the signed-in user's profile once; redirects to /login if there is none. */
export function SessionGate({ children, managerOnly = false, repOnly = false }: { children: React.ReactNode; managerOnly?: boolean; repOnly?: boolean }) {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase().auth.getUser();
      if (!u.user) return router.replace("/login");
      const { data, error } = await supabase().from("profiles").select("id, full_name, role, active").eq("id", u.user.id).single();
      if (error || !data) return setProblem("Your account has no profile yet. Ask your manager.");
      if (!data.active) return setProblem("Your account is switched off. Ask your manager.");
      if (managerOnly && data.role !== "manager") return router.replace("/");
      if (repOnly && data.role === "manager") return router.replace("/dashboard");
      setP(data as Profile);
    })();
  }, [router, managerOnly, repOnly]);

  if (problem) return (
    <main className="mx-auto max-w-md p-8">
      <p className="text-lg font-semibold text-alert">{problem}</p>
      <button className="mt-4 underline" onClick={async () => { await supabase().auth.signOut(); router.replace("/login"); }}>Sign out</button>
    </main>
  );
  if (!p) return <main className="p-8 text-muted">Loading…</main>;
  return <Ctx.Provider value={p}>{children}</Ctx.Provider>;
}

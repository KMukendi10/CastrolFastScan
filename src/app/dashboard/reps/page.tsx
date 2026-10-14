"use client";
import { useEffect, useState } from "react";
import { SessionGate } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { supabase } from "@/lib/supabase";
import { Banner, Button, Field, TextInput } from "@/components/ui";
import Link from "next/link";

type Rep = { id: string; full_name: string; email: string; role: "rep" | "manager"; active: boolean; created_at: string };

// Helper — calls an API route with the current session token
async function api(path: string, method: string, body?: unknown) {
  const { data: { session } } = await supabase().auth.getSession();
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

// ── Add / Edit modal ────────────────────────────────────────────────────────
function RepModal({ rep, onClose, onSaved }: {
  rep: Rep | null; // null = adding new
  onClose: () => void;
  onSaved: (r: Rep) => void;
}) {
  const isNew = !rep;
  const [fullName, setFullName] = useState(rep?.full_name ?? "");
  const [email, setEmail] = useState(rep?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"rep" | "manager">(rep?.role ?? "rep");
  const [active, setActive] = useState(rep?.active ?? true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      if (isNew) {
        const created = await api("/api/reps", "POST", { full_name: fullName, email, password, role });
        onSaved(created);
      } else {
        const patch: Record<string, unknown> = {};
        if (fullName !== rep.full_name) patch.full_name = fullName;
        if (email !== rep.email) patch.email = email;
        if (role !== rep.role) patch.role = role;
        if (active !== rep.active) patch.active = active;
        if (Object.keys(patch).length) await api(`/api/reps/${rep.id}`, "PATCH", patch);
        onSaved({ ...rep, full_name: fullName, email, role, active });
      }
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-5 text-2xl font-bold">{isNew ? "Add rep" : "Edit rep"}</h2>
        {err && <Banner tone="error">{err}</Banner>}
        <form onSubmit={save} className="mt-4 space-y-4">
          <Field label="Full name">
            <TextInput required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {isNew && (
            <Field label="Password" hint="At least 8 characters">
              <TextInput type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Field label="Role">
            <select className="w-full min-h-14 rounded-xl border-2 border-line bg-card px-4 text-lg outline-none focus:border-brand"
              value={role} onChange={(e) => setRole(e.target.value as "rep" | "manager")}>
              <option value="rep">Rep</option>
              <option value="manager">Manager</option>
            </select>
          </Field>
          {!isNew && (
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-5 w-5 accent-brand" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Account active
            </label>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={busy} className="flex-1">{busy ? "Saving…" : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Reset password modal ────────────────────────────────────────────────────
function ResetModal({ rep, onClose }: { rep: Rep; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErr("Passwords do not match");
    setBusy(true); setErr("");
    try {
      await api(`/api/reps/${rep.id}/reset-password`, "POST", { password });
      setDone(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-2xl font-bold">Reset password</h2>
        <p className="mb-5 text-muted">{rep.full_name} · {rep.email}</p>
        {done ? (
          <div className="space-y-4">
            <Banner tone="ok">Password updated successfully.</Banner>
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {err && <Banner tone="error">{err}</Banner>}
            <Field label="New password" hint="At least 8 characters">
              <TextInput type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm password">
              <TextInput type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={busy} className="flex-1">{busy ? "Saving…" : "Reset password"}</Button>
              <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
function ManageReps() {
  const [reps, setReps] = useState<Rep[] | null>(null);
  const [err, setErr] = useState("");
  const [editRep, setEditRep] = useState<Rep | null | "new">(null);
  const [resetRep, setResetRep] = useState<Rep | null>(null);

  async function load() {
    try {
      const data = await api("/api/reps", "GET");
      setReps(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load reps");
    }
  }

  useEffect(() => { load(); }, []);

  function onSaved(r: Rep) {
    setReps((prev) => {
      if (!prev) return [r];
      const idx = prev.findIndex((x) => x.id === r.id);
      if (idx === -1) return [...prev, r].sort((a, b) => a.full_name.localeCompare(b.full_name));
      const next = [...prev]; next[idx] = r; return next;
    });
  }

  async function toggleActive(rep: Rep) {
    try {
      await api(`/api/reps/${rep.id}`, "PATCH", { active: !rep.active });
      onSaved({ ...rep, active: !rep.active });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to update");
    }
  }

  return (
    <Shell back="/dashboard" title="Manage reps">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-bold">Reps & managers</h1>
        <Button onClick={() => setEditRep("new")}>+ Add person</Button>
      </div>

      {err && <p className="mt-3 font-semibold text-alert">{err}</p>}

      <section className="mt-6 overflow-x-auto rounded-2xl bg-card">
        <table className="w-full min-w-[640px] text-left">
          <thead className="border-b border-line text-sm text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Captures</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reps === null && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-muted">Loading…</td></tr>
            )}
            {reps?.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-semibold">
                  <Link href={`/dashboard/reps/${r.id}`} className="underline hover:text-brand transition-colors">
                    {r.full_name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted">{r.email}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${r.role === "manager" ? "bg-brand/10 text-brand" : "bg-line text-ink"}`}>
                    {r.role}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${r.active ? "bg-green-50 text-brand" : "bg-red-50 text-alert"}`}>
                    {r.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <Link href={`/dashboard/reps/${r.id}`} className="text-sm text-muted underline hover:text-brand transition-colors">
                    View captures →
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setEditRep(r)} className="text-sm font-semibold text-brand underline hover:opacity-70 transition-opacity">Edit</button>
                    <button onClick={() => setResetRep(r)} className="text-sm font-semibold text-muted underline hover:opacity-70 transition-opacity">Reset password</button>
                    <button onClick={() => toggleActive(r)} className={`text-sm font-semibold underline hover:opacity-70 transition-opacity ${r.active ? "text-alert" : "text-brand"}`}>
                      {r.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {reps?.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-muted">No users yet. Add one above.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Modals */}
      {editRep !== null && (
        <RepModal
          rep={editRep === "new" ? null : editRep}
          onClose={() => setEditRep(null)}
          onSaved={onSaved}
        />
      )}
      {resetRep && (
        <ResetModal rep={resetRep} onClose={() => setResetRep(null)} />
      )}
    </Shell>
  );
}

export default function Page() { return <SessionGate managerOnly><ManageReps /></SessionGate>; }

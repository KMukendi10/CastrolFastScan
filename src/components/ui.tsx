"use client";
import { useId } from "react";

export const inputCls =
  "w-full min-h-14 rounded-xl border-2 border-line bg-card px-4 text-lg outline-none hover:border-brand focus:border-brand transition-colors duration-150 disabled:opacity-60";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-semibold">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-sm text-muted">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-sm font-semibold text-alert">{error}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls + " " + (props.className ?? "")} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={inputCls + " py-3 " + (props.className ?? "")} />;
}

export function Select({ value, onChange, options, placeholder = "Choose…" }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** Big tap targets for a short list. Single choice. */
export function Choice({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o} role="radio" aria-checked={value === o} onClick={() => onChange(value === o ? "" : o)}
          className={"min-h-14 rounded-xl border-2 px-5 text-lg font-medium transition-all duration-150 " + (value === o ? "border-brand bg-brand text-white hover:brightness-110" : "border-line bg-card hover:border-brand hover:bg-brand/5")}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function Chips({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button type="button" key={o} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={"min-h-14 rounded-xl border-2 px-4 text-lg transition-all duration-150 " + (on ? "border-brand bg-brand text-white hover:brightness-110" : "border-line bg-card hover:border-brand hover:bg-brand/5")}>
            {on ? "✓ " : ""}{o}
          </button>
        );
      })}
    </div>
  );
}

/** Yes / No / not answered. */
export function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  const id = useId();
  return (
    <div className="flex gap-2" role="radiogroup" aria-labelledby={id}>
      {([true, false] as const).map((v) => (
        <button type="button" key={String(v)} role="radio" aria-checked={value === v} onClick={() => onChange(value === v ? null : v)}
          className={"min-h-14 min-w-28 rounded-xl border-2 px-6 text-lg font-medium transition-all duration-150 " + (value === v ? "border-brand bg-brand text-white hover:brightness-110" : "border-line bg-card hover:border-brand hover:bg-brand/5")}>
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

export function Button({ variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-brand text-white hover:brightness-110 active:brightness-95 disabled:bg-line disabled:text-muted disabled:hover:brightness-100",
    ghost: "border-2 border-line bg-card text-ink hover:border-brand hover:bg-brand hover:text-white active:brightness-95",
    danger: "bg-alert text-white hover:brightness-110 active:brightness-95",
  }[variant];
  return <button {...p} className={`min-h-14 rounded-xl px-6 text-lg font-semibold transition-all duration-150 ${v} ${className}`} />;
}

export function Banner({ tone, children }: { tone: "error" | "info" | "ok"; children: React.ReactNode }) {
  const c = { error: "border-alert bg-red-50 text-alert", info: "border-amber bg-amber-soft", ok: "border-brand bg-green-50 text-deep" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border-2 px-4 py-3 font-medium ${c}`}>{children}</div>;
}

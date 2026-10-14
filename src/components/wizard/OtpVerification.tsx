"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button, TextInput } from "@/components/ui";

export function OtpVerification({
  submissionId, kind, contact, verified, onVerified,
}: {
  submissionId: string; kind: "email" | "phone"; contact: string; verified: boolean; onVerified: (ok: boolean) => void;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [testBypass, setTestBypass] = useState(false);

  async function request(action: "send" | "verify") {
    setBusy(true);
    setMessage("");
    try {
      const { data: { session } } = await supabase().auth.getSession();
      const response = await fetch("/api/contact-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ submissionId, kind, contact, action, ...(action === "verify" ? { code } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not verify this contact detail.");
      if (result.verified) {
        setTestBypass(Boolean(result.testBypass));
        onVerified(true);
        setMessage(result.testBypass ? "Local test mode: no code was sent." : kind === "email" ? "Email verified." : "Phone number verified.");
        return;
      }
      if (action === "send") {
        setSent(true);
        setMessage(`Code sent to ${contact}.`);
      } else {
        onVerified(true);
        setMessage(kind === "email" ? "Email verified." : "Phone number verified.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify this contact detail.");
    } finally {
      setBusy(false);
    }
  }

  if (verified) return <p role="status" className="mt-2 text-sm font-semibold text-deep">{testBypass ? (kind === "email" ? "Email" : "Phone") + " bypassed for local testing (no code sent)" : (kind === "email" ? "Email verified" : "Phone verified")}</p>;
  return (
    <div className="mt-2 space-y-2">
      {!sent ? <Button type="button" variant="ghost" disabled={!contact || busy} onClick={() => request("send")}>
        {busy ? "Sending code…" : `Send ${kind === "email" ? "email" : "SMS"} code`}
      </Button> : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1">
            <span className="mb-1 block text-sm font-semibold">Six-digit code</span>
            <TextInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
          <Button type="button" disabled={busy || code.length !== 6} onClick={() => request("verify")}>
            {busy ? "Checking…" : "Verify code"}
          </Button>
          <button type="button" className="min-h-14 px-2 text-sm underline" disabled={busy} onClick={() => { setSent(false); setCode(""); setMessage(""); }}>Send another code</button>
        </div>
      )}
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </div>
  );
}

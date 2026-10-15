"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { SessionGate, useProfile } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Wizard } from "@/components/wizard/Wizard";
import { mechanicFlow } from "@/components/wizard/mechanicFlow";
import { sparesFlow } from "@/components/wizard/sparesFlow";
import { KIND_LABEL, type Kind } from "@/lib/options";

function Inner({ kind }: { kind: Kind }) {
  const p = useProfile();
  const searchParams = useSearchParams();
  const fresh = searchParams.get("fresh") ?? "initial";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flow: any = useMemo(() => (kind === "spares" ? sparesFlow() : mechanicFlow(kind)), [kind]);
  return (
    <Shell back="/" bleed>
      <Wizard key={fresh} flow={flow} draftKey={`draft:${p.id}:${kind}`} label={KIND_LABEL[kind]} />
    </Shell>
  );
}

export function CaptureClient({ kind }: { kind: Kind }) {
  return <SessionGate><Inner kind={kind} /></SessionGate>;
}

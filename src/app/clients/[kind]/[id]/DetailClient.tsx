"use client";
import { SessionGate } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ClientDetail } from "@/components/ClientDetail";

export function DetailClient({ kind, id }: { kind: "mechanic" | "spares"; id: number }) {
  return <SessionGate><Shell back="/clients"><ClientDetail kind={kind} id={id} editable /></Shell></SessionGate>;
}

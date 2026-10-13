import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DetailClient } from "./DetailClient";

async function Resolved({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if ((kind !== "mechanic" && kind !== "spares") || !/^\d+$/.test(id)) notFound();
  return <DetailClient kind={kind} id={Number(id)} />;
}

export default function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  return <Suspense fallback={null}><Resolved params={params} /></Suspense>;
}

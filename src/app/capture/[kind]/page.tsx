import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isKind } from "@/lib/options";
import { CaptureClient } from "./CaptureClient";

async function Resolved({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isKind(kind)) notFound();
  return <CaptureClient kind={kind} />;
}

export default function Page({ params }: { params: Promise<{ kind: string }> }) {
  return <Suspense fallback={null}><Resolved params={params} /></Suspense>;
}

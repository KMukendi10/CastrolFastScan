import { Suspense } from "react";
import { DrillClient } from "./Drill";

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DrillClient id={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={null}><Resolved params={params} /></Suspense>;
}

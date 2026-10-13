"use client";
import { useState } from "react";
import { Button, Banner } from "@/components/ui";

export type Gps = { lat: string; lon: string; acc: string };

export function GpsField({ value, onChange }: { value: Gps; onChange: (g: Gps) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const has = value.lat && value.lon;

  function grab() {
    setErr("");
    if (!navigator.geolocation) return setErr("This tablet cannot give a location.");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        onChange({ lat: p.coords.latitude.toFixed(6), lon: p.coords.longitude.toFixed(6), acc: String(Math.round(p.coords.accuracy)) });
      },
      (er) => { setBusy(false); setErr(er.code === 1 ? "Location is switched off for this app. Allow it in tablet settings." : "Could not get a location. Move outside and try again."); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" onClick={grab} disabled={busy}>{busy ? "Finding location…" : has ? "Capture again" : "Capture location"}</Button>
        {has && <span className="text-base">{value.lat}, {value.lon} <span className="text-muted">(±{value.acc} m)</span></span>}
      </div>
      {err && <Banner tone="error">{err}</Banner>}
    </div>
  );
}

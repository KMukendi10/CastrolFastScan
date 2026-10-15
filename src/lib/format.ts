// South African numbers: 0821234567, 082 123 4567 or +27 82 123 4567 -> +27821234567
export function toE164(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, "");
  if (/^\+27\d{9}$/.test(d)) return d;
  if (/^27\d{9}$/.test(d)) return "+" + d;
  if (/^0\d{9}$/.test(d)) return "+27" + d.slice(1);
  if (/^\+[1-9]\d{7,14}$/.test(d)) return d;
  return null;
}
export const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
export const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

export function normalizeGps(latitudeRaw: string, longitudeRaw: string, accuracyRaw: string) {
  if (!latitudeRaw.trim() || !longitudeRaw.trim()) return undefined;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  const accuracy = Number(accuracyRaw);
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    ...(Number.isFinite(accuracy) && accuracy > 0 ? { accuracy_m: accuracy } : {}),
  };
}
export const uuid = () => crypto.randomUUID();

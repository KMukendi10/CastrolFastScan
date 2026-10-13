"use client";
type Row = Record<string, unknown>;
const HIDE = new Set(["mechanic_id", "shop_id", "captured_by_user", "database_kind"]);

function show(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v && typeof v === "object") return Object.entries(v as Row).map(([k, x]) => `${k}: R${x}`).join(", ");
  return String(v);
}

/** Every filled-in field of a record, in the sheet's own column names. */
export function RecordView({ row }: { row: Row }) {
  const items = Object.entries(row).filter(([k, v]) => !HIDE.has(k) && v !== null && v !== "" && v !== undefined);
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="border-b border-line pb-2">
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="text-lg font-medium break-words">{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

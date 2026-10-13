import * as XLSX from "xlsx";

/**
 * Converts an array of row objects into an xlsx Uint8Array.
 * Column headers are taken from the keys of the first row.
 */
export function toXlsx(rows: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/**
 * Triggers a browser download of an xlsx file.
 */
export function downloadXlsx(filename: string, data: ArrayBuffer) {
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * STUB: Syncs a set of rows to the manager's live Excel sheet.
 *
 * When you're ready to wire this up, replace the body with a call to
 * Microsoft Graph API or Google Sheets API. The rows argument is the
 * same data that gets downloaded locally.
 *
 * Microsoft Graph example endpoint:
 *   PATCH https://graph.microsoft.com/v1.0/me/drive/items/{item-id}/workbook/worksheets/{sheet}/range(address='{range}')
 *
 * Google Sheets example endpoint:
 *   PUT https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}
 *
 * For now this just logs what would be sent, so the structure is in place
 * and testable end-to-end before touching the live sheet.
 */
export async function syncToLiveSheet(
  sheetName: string,
  rows: Record<string, unknown>[]
): Promise<{ ok: boolean; message: string }> {
  // ── STUB ──────────────────────────────────────────────────────────────────
  // Replace this block with a real API call when the live sheet is ready.
  console.info(`[syncToLiveSheet] Would sync ${rows.length} rows to "${sheetName}".`);
  console.info("[syncToLiveSheet] First row sample:", rows[0] ?? "(empty)");
  // ── END STUB ──────────────────────────────────────────────────────────────
  return { ok: true, message: `Sync stubbed — ${rows.length} rows ready to push to "${sheetName}".` };
}

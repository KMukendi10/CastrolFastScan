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

/** Creates one workbook with a worksheet for each dataset. */
export function toWorkbookXlsx(sheets: { name: string; rows: Record<string, unknown>[] }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = sheet.rows.length ? XLSX.utils.json_to_sheet(sheet.rows) : XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
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

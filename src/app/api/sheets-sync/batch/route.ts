import { requireManager, supabaseAdmin } from "@/lib/supabase-admin";

type BatchRequest = { kind?: "mechanic"; restoreMissing?: boolean };
type KindResult = {
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
  tab?: string;
  spreadsheetName?: string;
  spreadsheetUrl?: string;
  writtenRows?: number[];
  error?: string;
};

export async function POST(req: Request) {
  try {
    if (!(await requireManager(req))) {
      return Response.json({ error: "An active manager account is required to sync the sheet." }, { status: 401 });
    }
    const body = await req.json() as BatchRequest;
    if (body.kind !== "mechanic") {
      return Response.json({ error: "Only mechanic sync to WhatsApp Import is configured." }, { status: 400 });
    }

    const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
    const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET;
    if (!endpoint || !secret) {
      return Response.json({ error: "Google Sheets sync is not configured. Add the Apps Script URL and shared secret to .env.local, then restart the app." }, { status: 503 });
    }

    const results = { mechanic: await syncKind("mechanic", endpoint, secret, body.restoreMissing === true) };

    const mechanicsSynced = results.mechanic?.syncedCount ?? 0;
    const skippedCount = Object.values(results).reduce((count, result) => count + result.skippedCount, 0);
    const failedCount = Object.values(results).reduce((count, result) => count + result.failedCount, 0);
    const syncError = Object.values(results).find((result) => result.error)?.error;
    if (failedCount || syncError) {
      return Response.json({ mechanicsSynced, skippedCount, failedCount, error: syncError ?? `Some rows failed to sync (${failedCount}). Retry to try again.` }, { status: 502 });
    }
    return Response.json({
      mechanicsSynced,
      skippedCount,
      failedCount: 0,
      tab: results.mechanic?.tab,
      spreadsheetName: results.mechanic?.spreadsheetName,
      spreadsheetUrl: results.mechanic?.spreadsheetUrl,
      writtenRows: results.mechanic?.writtenRows,
    });
  } catch (error) {
    console.error("[sheets-sync-batch] Sync request failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Could not sync saved records to Google Sheets." }, { status: 502 });
  }
}

async function syncKind(kind: "mechanic" | "spares", endpoint: string, secret: string, restoreMissing: boolean): Promise<KindResult> {
  const view = kind === "mechanic" ? "v_mechanic_flat" : "v_spares_latest";
  const idColumn = kind === "mechanic" ? "mechanic_id" : "shop_id";
  const admin = supabaseAdmin();
  const { data, error } = await admin.from(view).select("*").limit(1000);
  if (error) {
    console.error("[sheets-sync-batch] Supabase query failed", error.code);
    return { syncedCount: 0, skippedCount: 0, failedCount: 0, error: "Could not load saved rows for the sheet." };
  }
  const records = (data ?? []).map((row: Record<string, unknown>) => ({ recordId: row[idColumn], row }));
  const table = kind === "mechanic" ? "mechanics" : "spares_shops";
  const { data: deleted, error: deletedError } = await admin.from(table).select(idColumn).not("deleted_at", "is", null);
  if (deletedError) {
    console.error("[sheets-sync-batch] Could not check deleted rows", deletedError.code);
    return { syncedCount: 0, skippedCount: 0, failedCount: 0, error: "Could not check registration deletion status." };
  }
  const deletedIds = new Set((deleted ?? []).map((row: Record<string, unknown>) => Number(row[idColumn])));
  const activeRecords = records.filter((record) => !deletedIds.has(Number(record.recordId)));
  if (!activeRecords.length) return { syncedCount: 0, skippedCount: 0, failedCount: 0 };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, kind, records: activeRecords, restoreMissing }),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as {
    synced?: boolean;
    syncedCount?: number;
    skippedCount?: number;
    failedCount?: number;
    errors?: string[];
    error?: string;
    tab?: string;
    spreadsheetName?: string;
    spreadsheetUrl?: string;
    writtenRows?: number[];
  } | null;
  if (!response.ok || !result) return { syncedCount: 0, skippedCount: 0, failedCount: activeRecords.length, error: result?.error ?? "Google Sheets could not process the sync." };
  if (
    typeof result.syncedCount !== "number" ||
    typeof result.skippedCount !== "number" ||
    typeof result.failedCount !== "number" ||
    result.tab !== "WhatsApp Import" ||
    typeof result.spreadsheetName !== "string" ||
    typeof result.spreadsheetUrl !== "string" ||
    !Array.isArray(result.writtenRows)
  ) {
    return {
      syncedCount: 0,
      skippedCount: 0,
      failedCount: activeRecords.length,
      error: "The Apps Script deployment is outdated. Update it to the latest Code.gs, create a new deployment version, then sync again.",
    };
  }
  if (result.failedCount || !result.synced) {
    return {
      syncedCount: result.syncedCount ?? 0,
      skippedCount: result.skippedCount ?? 0,
      failedCount: result.failedCount ?? activeRecords.length,
      error: result.error ?? result.errors?.[0] ?? "Google Sheets could not sync some saved rows.",
    };
  }
  return {
    syncedCount: result.syncedCount,
    skippedCount: result.skippedCount,
    failedCount: 0,
    tab: result.tab,
    spreadsheetName: result.spreadsheetName,
    spreadsheetUrl: result.spreadsheetUrl,
    writtenRows: result.writtenRows,
  };
}

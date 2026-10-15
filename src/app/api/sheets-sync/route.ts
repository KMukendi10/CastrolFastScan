import { supabaseAdmin } from "@/lib/supabase-admin";

type SyncRequest = { kind?: string; recordId?: number };

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Sign in again before syncing." }, { status: 401 });

    const admin = supabaseAdmin();
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role, active").eq("id", user.id).maybeSingle();
    if (profileError || !profile || !profile.active || !["rep", "manager"].includes(profile.role)) {
      return Response.json({ error: "An active Castrol FastScan rep account is required to sync a registration." }, { status: 403 });
    }

    const body = await req.json() as SyncRequest;
    if (!(["mechanic", "spares"] as const).includes(body.kind as "mechanic" | "spares") ||
        !Number.isSafeInteger(body.recordId) || Number(body.recordId) < 1) {
      return Response.json({ error: "Invalid registration to sync." }, { status: 400 });
    }

    const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
    const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET;
    if (!endpoint || !secret) {
      return Response.json({ configured: false, synced: false, message: "Google Sheet sync is not configured yet." });
    }

    const view = body.kind === "mechanic" ? "v_mechanic_flat" : "v_spares_latest";
    const idColumn = body.kind === "mechanic" ? "mechanic_id" : "shop_id";
    const { data: row, error: rowError } = await admin.from(view).select("*").eq(idColumn, body.recordId).maybeSingle();
    if (rowError || !row) {
      console.error("[sheets-sync] Saved row lookup failed", rowError?.code);
      return Response.json({ error: "The saved registration could not be prepared for Google Sheets." }, { status: 502 });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, kind: body.kind, recordId: body.recordId, row }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => null) as { synced?: boolean; skippedCount?: number; error?: string } | null;
    if (!response.ok || !result?.synced) {
      console.error("[sheets-sync] Google Apps Script rejected the row", response.status, result?.error);
      return Response.json({ error: result?.error ?? "Google Sheets could not accept this registration." }, { status: 502 });
    }
    return Response.json({ configured: true, synced: true, skipped: (result.skippedCount ?? 0) > 0 });
  } catch (error) {
    console.error("[sheets-sync] Sync request failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Could not sync this registration to Google Sheets." }, { status: 502 });
  }
}

import { supabaseAdmin } from "@/lib/supabase-admin";

export async function DELETE(req: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind, id } = await context.params;
    if (!(kind === "mechanic" || kind === "spares") || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) {
      return Response.json({ error: "Invalid registration." }, { status: 400 });
    }

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Sign in again before deleting a registration." }, { status: 401 });

    const admin = supabaseAdmin();
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role, active").eq("id", user.id).maybeSingle();
    if (profileError || !profile || !profile.active || !["rep", "manager"].includes(profile.role)) {
      return Response.json({ error: "An active Castrol FastScan account is required." }, { status: 403 });
    }

    const table = kind === "mechanic" ? "mechanics" : "spares_shops";
    const idColumn = kind === "mechanic" ? "mechanic_id" : "shop_id";
    const { data: record, error: recordError } = await admin.from(table)
      .select(`captured_by_user, deleted_at${kind === "mechanic" ? ", mechanic_email" : ""}`)
      .eq(idColumn, Number(id)).maybeSingle();
    if (recordError) {
      console.error("[registration-delete] Record lookup failed", recordError.code);
      if (recordError.code === "42703" || recordError.code === "PGRST204") {
        return Response.json({ error: "Registration deletion is not set up in Supabase yet. Run db/006_registration_deletion.sql in the project’s SQL Editor." }, { status: 503 });
      }
      return Response.json({ error: "Could not check registration ownership." }, { status: 500 });
    }
    if (!record || record.deleted_at || (profile.role !== "manager" && record.captured_by_user !== user.id)) {
      return Response.json({ error: "Registration not found or you do not have permission to delete it." }, { status: 404 });
    }

    const { data: deletedRecord, error: deleteError } = await admin.from(table)
      .update({ deleted_at: new Date().toISOString(), deleted_by_user: user.id })
      .eq(idColumn, Number(id)).is("deleted_at", null).select(idColumn).maybeSingle();
    if (deleteError) {
      console.error("[registration-delete] Soft delete failed", deleteError.code);
      return Response.json({ error: "Could not delete this registration." }, { status: 500 });
    }
    if (!deletedRecord) return Response.json({ error: "This registration has already been deleted." }, { status: 409 });

    if (kind === "mechanic") {
      const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
      const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET;
      if (endpoint && secret) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret, kind: "mechanic", action: "delete", mechanicEmail: record.mechanic_email }),
            cache: "no-store",
          });
          const result = await response.json().catch(() => null) as { deleted?: boolean; error?: string } | null;
          if (response.ok && result?.deleted) return Response.json({ deleted: true, sheetDeleted: true });
          console.error("[registration-delete] Sheet rejected deletion", response.status, result?.error);
        } catch (error) {
          console.error("[registration-delete] Sheet deletion request failed", error instanceof Error ? error.message : "unknown error");
        }
        return Response.json({ deleted: true, sheetDeleted: false, message: "The registration was removed from the app, but its sheet row could not be removed. Ask a manager to check WhatsApp Import." });
      }
      return Response.json({ deleted: true, sheetDeleted: false, message: "The registration was removed from the app. Google Sheets sync is not configured, so check WhatsApp Import manually if it was synced before." });
    }

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("[registration-delete] Request failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Could not delete this registration." }, { status: 500 });
  }
}

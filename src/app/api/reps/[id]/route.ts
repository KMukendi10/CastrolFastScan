import { supabaseAdmin, requireManager } from "@/lib/supabase-admin";

// PATCH /api/reps/[id] — update name, email, role, or active status
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await requireManager(req);
  if (!caller) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const admin = supabaseAdmin();

  // Update email in auth.users if provided
  if (body.email !== undefined) {
    const { error } = await admin.auth.admin.updateUserById(id, { email: body.email });
    if (error) return Response.json({ error: error.message }, { status: 400 });
  }

  // Update profile fields (full_name, role, active)
  const profileUpdate: Record<string, unknown> = {};
  if (body.full_name !== undefined) profileUpdate.full_name = body.full_name;
  if (body.role !== undefined) profileUpdate.role = body.role;
  if (body.active !== undefined) profileUpdate.active = body.active;

  if (Object.keys(profileUpdate).length) {
    const { error } = await admin.from("profiles").update(profileUpdate).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true });
}

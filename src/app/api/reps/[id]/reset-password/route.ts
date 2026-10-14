import { supabaseAdmin, requireManager } from "@/lib/supabase-admin";

// POST /api/reps/[id]/reset-password — set a new password for a rep
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await requireManager(req);
  if (!caller) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await params;
  const { password } = await req.json();
  if (!password || password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ ok: true });
}

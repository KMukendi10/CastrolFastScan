import { supabaseAdmin, requireManager } from "@/lib/supabase-admin";

// GET /api/reps — list all reps with their email from auth.users
export async function GET(req: Request) {
  const caller = await requireManager(req);
  if (!caller) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const admin = supabaseAdmin();

  // Fetch profiles
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, full_name, role, active, created_at")
    .order("full_name");
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  // Fetch auth users to get emails (service role only)
  const { data: { users }, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (uErr) return Response.json({ error: uErr.message }, { status: 500 });

  const emailMap = new Map(users.map((u) => [u.id, u.email ?? ""]));

  const reps = (profiles ?? []).map((p) => ({
    ...p,
    email: emailMap.get(p.id) ?? "",
  }));

  return Response.json(reps);
}

// POST /api/reps — create a new rep or manager
export async function POST(req: Request) {
  const caller = await requireManager(req);
  if (!caller) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const { full_name, email, password, role = "rep" } = await req.json();
  if (!full_name || !email || !password) return Response.json({ error: "full_name, email and password are required" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  if (!["rep", "manager"].includes(role)) return Response.json({ error: "role must be rep or manager" }, { status: 400 });

  const admin = supabaseAdmin();

  // Create the auth user — the handle_new_user trigger creates the profile automatically
  const { data: { user }, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (cErr) return Response.json({ error: cErr.message }, { status: 400 });
  if (!user) return Response.json({ error: "User creation failed" }, { status: 500 });

  // If manager, update the profile role (trigger sets it to rep by default)
  if (role === "manager") {
    await admin.from("profiles").update({ role: "manager" }).eq("id", user.id);
  }

  return Response.json({ id: user.id, full_name, email, role, active: true }, { status: 201 });
}

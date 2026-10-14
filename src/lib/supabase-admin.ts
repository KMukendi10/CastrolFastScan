import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service role key.
 * NEVER import this in client components — it would expose the secret key.
 * Only use inside API route handlers (src/app/api/**).
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Verifies the Bearer token from a request and returns the caller's profile.
 * Returns null if the token is invalid or the caller is not an active manager.
 */
export async function requireManager(req: Request): Promise<{ id: string; full_name: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const admin = supabaseAdmin();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await admin.from("profiles").select("id, full_name, role, active").eq("id", user.id).single();
  if (!data || data.role !== "manager" || !data.active) return null;
  return { id: data.id, full_name: data.full_name };
}

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Kind = "email" | "phone";
type Challenge = { submissionId: string; kind: Kind; contact: string; code?: string };

async function repAccessError(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return "No rep session reached the verification service. Sign out, sign back in, and retry.";
  const admin = supabaseAdmin();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) {
    const reason = error?.code ?? (error?.status ? `HTTP ${error.status}` : "no user returned");
    console.error("[contact-verification] Supabase rejected the rep session", { reason });
    return `Supabase rejected the rep session (${reason}). Check that NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY all come from the same project. Restart the dev server and sign in again.`;
  }
  const { data, error: profileError } = await admin.from("profiles").select("active").eq("id", user.id).maybeSingle();
  if (profileError) {
    const reason = profileError.code ?? "database error";
    console.error("[contact-verification] Rep profile lookup failed", { reason, message: profileError.message });
    return `The rep profile lookup failed (${reason}). Confirm db/002_reps_and_rls.sql has been run in this Supabase project and retry.`;
  }
  if (!data) return "This login has no FastScan rep profile. Ask a manager to check the account setup.";
  if (!data.active) return "This FastScan account is inactive. Ask a manager to reactivate it.";
  return null;
}

function normalized(kind: Kind, contact: string) {
  return kind === "email" ? contact.trim().toLowerCase() : contact.trim();
}

function codeHash(code: string) {
  const secret = process.env.CONTACT_OTP_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("GENERATE-")) throw new Error("Set CONTACT_OTP_SECRET to a random secret of at least 32 characters");
  return createHmac("sha256", secret).update(code).digest("hex");
}

function sameHash(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function twilio(path: "Verifications" | "VerificationCheck", params: Record<string, string>) {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!account || !auth || !service) throw new Error("Twilio Verify is not configured");
  const response = await fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${account}:${auth}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "The SMS service could not process the request");
  return result as { status?: string };
}

async function sendEmail(contact: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new Error("Resend email is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [contact],
      subject: "Your FastScan verification code",
      text: `Your FastScan verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.message ?? "The email service could not send the code");
  }
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: Request) {
  try {
    const accessError = await repAccessError(req);
    if (accessError) return Response.json({ error: accessError }, { status: 401 });
    const body = await req.json() as Challenge & { action?: string };
    if (!body.submissionId || !validUuid(body.submissionId) || !["email", "phone"].includes(body.kind) || typeof body.contact !== "string") {
      return Response.json({ error: "Invalid verification request." }, { status: 400 });
    }
    const kind = body.kind;
    const contact = normalized(kind, body.contact);
    if ((kind === "email" && (contact.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact))) ||
        (kind === "phone" && !/^\+[1-9]\d{7,14}$/.test(contact))) {
      return Response.json({ error: "Check the email address or phone number." }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const now = Date.now();
    await admin.from("contact_verifications").delete().lt("expires_at", new Date(now).toISOString());
    const { data: existing } = await admin.from("contact_verifications")
      .select("contact, sent_at, verified_at, expires_at")
      .eq("submission_id", body.submissionId).eq("kind", kind).maybeSingle();
    if (existing?.contact === contact && existing.verified_at && Date.parse(existing.expires_at) > now) {
      return Response.json({ verified: true });
    }

    if (body.action === "send") {
      // Explicit opt-in for local development only. This still writes a proof
      // consumed by the database submit functions, but can never bypass OTP in
      // production even if the environment variable is accidentally enabled.
      if (process.env.NODE_ENV === "development" && process.env.CONTACT_VERIFICATION_BYPASS === "true") {
        const { error } = await admin.from("contact_verifications").upsert({
          submission_id: body.submissionId, kind, contact, code_hash: null, attempts: 0,
          sent_at: new Date(now).toISOString(), verified_at: new Date(now).toISOString(),
          expires_at: new Date(now + 30 * 60_000).toISOString(),
        });
        if (error) throw new Error("Could not record the local test verification.");
        return Response.json({ verified: true, testBypass: true });
      }

      const { data: recent, error: recentError } = await admin.from("contact_verifications")
        .select("sent_at").eq("kind", kind).eq("contact", contact)
        .gt("sent_at", new Date(now - 15 * 60_000).toISOString()).order("sent_at", { ascending: false }).limit(3);
      if (recentError) throw new Error("Verification storage is not ready. Apply the contact verification database migration.");
      if ((recent?.length ?? 0) >= 3) return Response.json({ error: "Too many codes were requested. Try again in 15 minutes." }, { status: 429 });
      if (recent?.[0] && now - Date.parse(recent[0].sent_at) < 60_000) return Response.json({ error: "Wait a minute before requesting another code." }, { status: 429 });

      if (kind === "phone") {
        await twilio("Verifications", { To: contact, Channel: "sms" });
        const { error } = await admin.from("contact_verifications").upsert({
          submission_id: body.submissionId, kind, contact, code_hash: null, attempts: 0,
          sent_at: new Date().toISOString(), verified_at: null,
          expires_at: new Date(now + 10 * 60_000).toISOString(),
        });
        if (error) throw new Error("Could not record the SMS challenge.");
      } else {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const hashedCode = codeHash(code);
        await sendEmail(contact, code);
        const { error } = await admin.from("contact_verifications").upsert({
          submission_id: body.submissionId, kind, contact, code_hash: hashedCode, attempts: 0,
          sent_at: new Date().toISOString(), verified_at: null,
          expires_at: new Date(now + 10 * 60_000).toISOString(),
        });
        if (error) throw new Error("Could not record the email challenge.");
      }
      return Response.json({ sent: true });
    }

    if (body.action === "verify") {
      const code = body.code?.trim() ?? "";
      if (!/^\d{6}$/.test(code)) return Response.json({ error: "Enter the six-digit code." }, { status: 400 });
      if (kind === "phone") {
        if (!existing || existing.contact !== contact || Date.parse(existing.expires_at) <= now || existing.verified_at) {
          return Response.json({ error: "Request a new code before verifying this number." }, { status: 400 });
        }
        const result = await twilio("VerificationCheck", { To: contact, Code: code });
        if (result.status !== "approved") return Response.json({ error: "That code is incorrect or expired." }, { status: 400 });
      } else {
        if (!existing || existing.contact !== contact || Date.parse(existing.expires_at) <= now) {
          return Response.json({ error: "That code has expired. Request a new one." }, { status: 400 });
        }
        const { data: challenge, error } = await admin.from("contact_verifications")
          .select("code_hash, attempts, verified_at").eq("submission_id", body.submissionId).eq("kind", kind).single();
        if (error || challenge.verified_at || !challenge.code_hash || challenge.attempts >= 5) {
          return Response.json({ error: "Request a new code to continue." }, { status: 400 });
        }
        const matched = sameHash(codeHash(code), challenge.code_hash);
        const { data: updated, error: updateError } = await admin.from("contact_verifications").update({
          attempts: challenge.attempts + 1,
          ...(matched ? { verified_at: new Date().toISOString(), expires_at: new Date(now + 30 * 60_000).toISOString(), code_hash: null } : {}),
        }).eq("submission_id", body.submissionId).eq("kind", kind).eq("attempts", challenge.attempts)
          .is("verified_at", null).select("submission_id").maybeSingle();
        if (updateError) throw new Error("Could not update the verification status.");
        if (!updated) return Response.json({ error: "That code was already checked. Request a new code if needed." }, { status: 409 });
        if (!matched) return Response.json({ error: "That code is incorrect." }, { status: 400 });
      }
      if (kind === "phone") {
        const { error } = await admin.from("contact_verifications").upsert({
          submission_id: body.submissionId, kind, contact, code_hash: null, attempts: 0,
          sent_at: existing?.sent_at ?? new Date().toISOString(), verified_at: new Date().toISOString(),
          expires_at: new Date(now + 30 * 60_000).toISOString(),
        });
        if (error) throw new Error("Could not record the verified phone number.");
      }
      return Response.json({ verified: true });
    }
    return Response.json({ error: "Unknown verification action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}

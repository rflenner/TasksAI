import { desc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { notificationOptouts } from "../../../../db/schema";
import { addOptOut, isValidEmail, normalizeEmail, removeOptOut } from "../../../lib/close-plan-notify-rules";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

export const dynamic = "force-dynamic";

// People excluded from Close Plan emails, for Site Admins. Whoever asks not to be emailed goes here; the senders skip them.
async function admin() {
  const actor = await currentActor();
  if (!actor) return { error: Response.json({ error: "Sign in required" }, { status: 401 }) };
  if (actor.role !== "site_admin") return { error: Response.json({ error: "Site Admin access required" }, { status: 403 }) };
  return { actor };
}
export async function GET() {
  const a = await admin(); if (a.error) return a.error;
  const rows = await getDb().select().from(notificationOptouts).orderBy(desc(notificationOptouts.createdAt));
  return Response.json({ optouts: rows.map(r => ({ email: r.email, source: r.source, reason: r.reason, createdAt: r.createdAt.toISOString() })) });
}
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const a = await admin(); if (a.error) return a.error;
  const body = await request.json().catch(() => ({})) as { email?: string; reason?: string };
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return Response.json({ error: "That isn't a valid email address" }, { status: 400 });
  await addOptOut(email, "admin", typeof body.reason === "string" ? body.reason : null, a.actor!.id ?? null);
  return Response.json({ ok: true });
}
export async function DELETE(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const a = await admin(); if (a.error) return a.error;
  const body = await request.json().catch(() => ({})) as { email?: string };
  await removeOptOut(normalizeEmail(body.email));
  return Response.json({ ok: true });
}

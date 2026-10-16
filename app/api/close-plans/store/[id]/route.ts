import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { closePlanDocuments } from "../../../../../db/schema";
import { canAccessPlan, canCreatePlan, canDeletePlan, memberEmails, validatePlan } from "../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../lib/request";
import { currentActor } from "../../../../lib/session";

export const dynamic = "force-dynamic";

// Save a plan. `version` is the version the page last loaded (0 for a new
// plan); a mismatch means someone else saved in between, so nothing is written
// and the current version comes back (409) for the page to reload.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { version?: unknown; data?: unknown } | null;
  const checked = validatePlan(id, body?.data);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
  const data = checked.data, expected = Number(body?.version) || 0;
  const title = String(data.title || "Close plan").slice(0, 200), account = String(data.account || "").slice(0, 200);
  const [existing] = await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, id)).limit(1);

  if (!existing) {
    if (!canCreatePlan(actor)) return Response.json({ error: "Only admins can create close plans" }, { status: 403 });
    const [row] = await getDb().insert(closePlanDocuments).values({ id, title, account, data, memberEmails: memberEmails(data), version: 1, createdBy: actor.id, updatedBy: actor.id }).onConflictDoNothing().returning();
    if (!row) return Response.json({ error: "conflict" }, { status: 409 });
    return Response.json({ id, version: row.version, updatedAt: row.updatedAt.toISOString() }, { status: 201 });
  }
  if (existing.deletedAt) return Response.json({ error: "This plan was deleted" }, { status: 410 });
  if (!canAccessPlan(actor, existing)) return Response.json({ error: "You are not on this plan" }, { status: 403 });
  if (existing.version !== expected) return Response.json({ error: "conflict", plan: { id, version: existing.version, updatedAt: existing.updatedAt.toISOString(), data: existing.data } }, { status: 409 });
  const [row] = await getDb().update(closePlanDocuments)
    .set({ title, account, data, memberEmails: memberEmails(data), version: existing.version + 1, updatedBy: actor.id, updatedAt: new Date() })
    .where(and(eq(closePlanDocuments.id, id), eq(closePlanDocuments.version, existing.version), isNull(closePlanDocuments.deletedAt))).returning();
  if (!row) return Response.json({ error: "conflict" }, { status: 409 });
  return Response.json({ id, version: row.version, updatedAt: row.updatedAt.toISOString() });
}

// Delete a plan (soft): the iSEEit plan owner or an administrator (Site or Area Admin).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const [existing] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!existing) return Response.json({ ok: true });
  if (!canAccessPlan(actor, existing) || !canDeletePlan(actor, existing.data)) return Response.json({ error: "Only the iSEEit plan owner or an administrator can delete this plan" }, { status: 403 });
  await getDb().update(closePlanDocuments).set({ deletedAt: new Date(), updatedBy: actor.id }).where(eq(closePlanDocuments.id, id));
  return Response.json({ ok: true });
}

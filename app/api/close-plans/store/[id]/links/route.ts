import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { createPlanLink, revokePlanLinks } from "../../../../../lib/close-plan-links";
import { customerPerson } from "../../../../../lib/close-plan-share";
import { canAccessPlan, canManagePlanLinks } from "../../../../../lib/close-plan-store";
import { appLinkUrl, requireSameOrigin } from "../../../../../lib/request";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

// Personal links for a plan's customer contacts. Same people who manage the
// plan's people: the iSEEit plan owner or a Site Admin.
async function guard(request: Request, id: string) {
  const invalid = requireSameOrigin(request); if (invalid) return { error: invalid };
  const actor = await currentActor();
  if (!actor) return { error: Response.json({ error: "Sign in required" }, { status: 401 }) };
  const [row] = await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, id)).limit(1);
  if (!row || row.deletedAt || !canAccessPlan(actor, row)) return { error: Response.json({ error: "Plan not found" }, { status: 404 }) };
  if (!canManagePlanLinks(actor, row.data)) return { error: Response.json({ error: "Only the iSEEit plan owner can manage personal links" }, { status: 403 }) };
  return { actor, row };
}

// Create a new personal link for one customer contact. Earlier links keep working until they expire or are revoked.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(request, id); if (g.error) return g.error;
  const body = await request.json().catch(() => null) as { personId?: unknown } | null;
  const personId = typeof body?.personId === "string" ? body.personId : "";
  if (!customerPerson(g.row!.data, personId)) return Response.json({ error: "Save the plan with this contact first, then create the link" }, { status: 400 });
  const { token, expiresAt } = await createPlanLink(id, personId, g.actor!.id ?? null);
  return Response.json({ url: appLinkUrl(request, `/p/${token}`).toString(), expiresAt: expiresAt.toISOString() }, { status: 201 });
}

// Switch off every personal link of one contact.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(request, id); if (g.error) return g.error;
  const personId = new URL(request.url).searchParams.get("personId") || "";
  if (!personId) return Response.json({ error: "personId is required" }, { status: 400 });
  await revokePlanLinks(id, personId);
  return Response.json({ ok: true });
}

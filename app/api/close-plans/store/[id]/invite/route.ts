import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { sendInvitation } from "../../../../../lib/close-plan-invitations";
import { customerPerson } from "../../../../../lib/close-plan-share";
import { canAccessPlan, canManagePlanLinks } from "../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../lib/request";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

// "Send invitation" on a customer contact: creates their personal link and emails it (when the rules and the person allow it).
// The link is returned either way, so it can still be copied and sent by hand. Same people as the links route: the iSEEit
// plan owner or a Site Admin.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, id)).limit(1);
  if (!row || row.deletedAt || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  if (!canManagePlanLinks(actor, row.data)) return Response.json({ error: "Only the iSEEit plan owner can send invitations" }, { status: 403 });
  const body = await request.json().catch(() => null) as { personId?: unknown } | null;
  const personId = typeof body?.personId === "string" ? body.personId : "";
  if (!customerPerson(row.data as Record<string, unknown>, personId)) return Response.json({ error: "Save the plan with this contact first, then send the invitation" }, { status: 400 });
  const result = await sendInvitation({ plan: { id, title: row.title, data: row.data as Record<string, unknown> }, personId, fromName: actor.name || "Your iSEEit contact", createdBy: actor.id ?? null, kind: "invitation", baseUrl: new URL(request.url).origin });
  return Response.json(result, { status: 201 });
}

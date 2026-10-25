import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../../../db";
import { closePlanDocuments } from "../../../../../../../../db/schema";
import { canAccessPlan, canDeletePlan } from "../../../../../../../lib/close-plan-store";
import { contactPhotoResponse } from "../../../../../../../lib/org-chart-photo";
import { currentActor } from "../../../../../../../lib/session";

export const dynamic = "force-dynamic";

// A contact's picture for the org chart view of a plan (app/lib/org-chart-photo.ts). Plan owners and admins only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const actor = await currentActor();
  if (!actor) return new Response(null, { status: 401 });
  const { id, attachmentId } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row) || !canDeletePlan(actor, row.data as Parameters<typeof canDeletePlan>[1])) return new Response(null, { status: 404 });
  return contactPhotoResponse(attachmentId);
}

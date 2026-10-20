import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { closePlanDocuments } from "../../../../../../../db/schema";
import { planPhoto, photoResponse } from "../../../../../../lib/close-plan-photos";
import { canAccessPlan } from "../../../../../../lib/close-plan-store";
import { currentActor } from "../../../../../../lib/session";

export const dynamic = "force-dynamic";

// A contact's photo on this plan (copied from Salesforce, app/lib/close-plan-photos.ts), for the iSEEit team.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; personId: string }> }) {
  const actor = await currentActor();
  if (!actor) return new Response(null, { status: 401 });
  const { id, personId } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row)) return new Response(null, { status: 404 });
  return photoResponse(await planPhoto(id, personId));
}

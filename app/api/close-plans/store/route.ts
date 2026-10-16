import { desc, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { closePlanDocuments } from "../../../../db/schema";
import { canAccessPlan, canCreatePlan } from "../../../lib/close-plan-store";
import { currentActor } from "../../../lib/session";

// The close plans the signed-in user can see, plus who they are, so the page
// can act as them (attribution, plan-owner rights) instead of a fixed person.
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const rows = await getDb().select().from(closePlanDocuments).where(isNull(closePlanDocuments.deletedAt)).orderBy(desc(closePlanDocuments.updatedAt));
  const plans = rows.filter(row => canAccessPlan(actor, row)).map(row => ({ id: row.id, version: row.version, updatedAt: row.updatedAt.toISOString(), data: row.data }));
  return Response.json({ me: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, canCreate: canCreatePlan(actor) }, plans });
}

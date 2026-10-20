import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { lastSeen } from "../../../../../lib/close-plan-access-log";
import { canAccessPlan, canDeletePlan } from "../../../../../lib/close-plan-store";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

// When each person on this plan was last seen (the iSEEit team in Task AI, customers on their link), for the plan owner and admins.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, (await params).id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  if (!canDeletePlan(actor, row.data as Record<string, unknown>)) return Response.json({ error: "Only the plan owner and admins can see this" }, { status: 403 });
  return Response.json({ seen: await lastSeen(row.id, row.data as Record<string, unknown>) }, { headers: { "cache-control": "no-store" } });
}

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../../../db";
import { closePlanDocuments } from "../../../../../../../../db/schema";
import { taskHistory, taskTitleOf } from "../../../../../../../lib/close-plan-access-log";
import { canAccessPlan } from "../../../../../../../lib/close-plan-store";
import { currentActor } from "../../../../../../../lib/session";

export const dynamic = "force-dynamic";

// A task's history for the iSEEit team: what was changed and by whom, files, and who last opened it. Never shown to customers.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id, taskId } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row) || !taskTitleOf(row.data as Record<string, unknown>, taskId)) return Response.json({ error: "Task not found" }, { status: 404 });
  return Response.json({ history: await taskHistory(id, taskId) }, { headers: { "cache-control": "no-store" } });
}

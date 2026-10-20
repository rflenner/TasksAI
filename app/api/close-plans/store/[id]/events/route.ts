import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { CLIENT_EVENTS, logAccess, taskTitleOf, type AccessEvent } from "../../../../../lib/close-plan-access-log";
import { canAccessPlan } from "../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../lib/request";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

// The page tells us when a team member opens a plan or a task: { event: "plan_opened" | "task_opened", taskId? }. Logged for admins only (Admin → Close Plan activity).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => null) as { event?: string; taskId?: string } | null;
  const event = body?.event as AccessEvent;
  if (!CLIENT_EVENTS.includes(event)) return new Response(null, { status: 400 });
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, (await params).id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row)) return new Response(null, { status: 404 });
  const taskId = event === "task_opened" ? String(body?.taskId || "") : "", title = taskId ? taskTitleOf(row.data as Record<string, unknown>, taskId) : null;
  if (event === "task_opened" && !title) return new Response(null, { status: 404 });
  await logAccess({ event, side: "seller", via: "app", userId: actor.id, personName: actor.name, plan: { id: row.id, title: row.title }, task: taskId ? { id: taskId, title } : null, dedupeMinutes: event === "plan_opened" ? 30 : 10 });
  return new Response(null, { status: 204 });
}

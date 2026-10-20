import { logAccess, taskTitleOf } from "../../../../../lib/close-plan-access-log";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { addAttachment, listAttachments, readUploadForm, taskById } from "../../../../../lib/close-plan-attachments";
import { canAccessPlan, canDeletePlan } from "../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../lib/request";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  return row || null;
}

// The PDF files attached to the tasks of this plan, for the iSEEit team (app/lib/close-plan-attachments.ts).
export async function GET(_request: Request, { params }: Params) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const row = await load((await params).id);
  if (!row || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  return Response.json({ attachments: await listAttachments(row.id, { key: `u:${actor.id}`, admin: canDeletePlan(actor, row.data as Record<string, unknown>) }) }, { headers: { "cache-control": "no-store" } });
}

// Attach a PDF to a task: multipart form with `file`, `taskId` and `shared` ("false" keeps it from the customer).
export async function POST(request: Request, { params }: Params) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const row = await load((await params).id);
  if (!row || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  const form = await readUploadForm(request);
  if ("error" in form) return Response.json({ error: form.error }, { status: form.status });
  if (!taskById(row.data as Record<string, unknown>, form.taskId)) return Response.json({ error: "That task is not on this plan" }, { status: 404 });
  const result = await addAttachment(row.id, form.taskId, form.file, form.shared, { key: `u:${actor.id}`, name: actor.name, side: "seller" });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  void logAccess({ event: "file_added", side: "seller", via: "app", userId: actor.id, personName: actor.name, plan: { id: row.id, title: row.title }, task: { id: form.taskId, title: taskTitleOf(row.data as Record<string, unknown>, form.taskId) }, detail: result.meta.name });
  return Response.json({ attachment: result.meta }, { status: 201 });
}

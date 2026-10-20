import { logAccess, taskTitleOf } from "../../../../../../lib/close-plan-access-log";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { closePlanDocuments } from "../../../../../../../db/schema";
import { loadAttachment, pdfResponse, removeAttachment } from "../../../../../../lib/close-plan-attachments";
import { canAccessPlan, canDeletePlan } from "../../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../../lib/request";
import { currentActor } from "../../../../../../lib/session";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; aid: string }> };

async function authorize(params: Params["params"]) {
  const actor = await currentActor();
  if (!actor) return { response: new Response(null, { status: 401 }) };
  const { id, aid } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row)) return { response: new Response(null, { status: 404 }) };
  const file = await loadAttachment(id, aid);
  if (!file) return { response: new Response(null, { status: 404 }) };
  return { actor, row, file };
}

// Download one file (always as a download, never shown in the browser).
export async function GET(request: Request, { params }: Params) {
  const a = await authorize(params); if ("response" in a) return a.response;
  void logAccess({ event: new URL(request.url).searchParams.get("view") ? "file_viewed" : "file_downloaded", side: "seller", via: "app", userId: a.actor.id, personName: a.actor.name, plan: { id: a.row.id, title: a.row.title }, task: { id: a.file.taskId, title: taskTitleOf(a.row.data as Record<string, unknown>, a.file.taskId) }, detail: a.file.name, dedupeMinutes: 1 });
  return pdfResponse(a.file);
}

// Remove a file: whoever uploaded it, the plan owner and admins.
export async function DELETE(request: Request, { params }: Params) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const a = await authorize(params); if ("response" in a) return a.response;
  if (a.file.uploadedBy !== `u:${a.actor.id}` && !canDeletePlan(a.actor, a.row.data as Record<string, unknown>)) return Response.json({ error: "Only who added the file, the plan owner and admins can remove it" }, { status: 403 });
  await removeAttachment(a.row.id, a.file.id);
  void logAccess({ event: "file_removed", side: "seller", via: "app", userId: a.actor.id, personName: a.actor.name, plan: { id: a.row.id, title: a.row.title }, task: { id: a.file.taskId, title: taskTitleOf(a.row.data as Record<string, unknown>, a.file.taskId) }, detail: a.file.name });
  return Response.json({ ok: true });
}

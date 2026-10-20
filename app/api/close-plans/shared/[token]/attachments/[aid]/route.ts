import { logAccess, taskTitleOf } from "../../../../../../lib/close-plan-access-log";
import { customerSees, loadAttachment, pdfResponse, removeAttachment } from "../../../../../../lib/close-plan-attachments";
import { resolvePlanLink } from "../../../../../../lib/close-plan-links";
import { customerPerson } from "../../../../../../lib/close-plan-share";
import { requireSameOrigin } from "../../../../../../lib/request";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string; aid: string }> };

async function authorize(params: Params["params"]) {
  const { token, aid } = await params;
  const resolved = await resolvePlanLink(token);
  if (!resolved) return { response: new Response(null, { status: 410 }) };
  const data = resolved.row.data as Record<string, unknown>;
  const who = customerPerson(data, resolved.link.personId);
  if (!who) return { response: new Response(null, { status: 410 }) };
  const file = await loadAttachment(resolved.row.id, aid);
  if (!file || !customerSees(data, file)) return { response: new Response(null, { status: 404 }) };
  return { resolved, file, who };
}

// Download a shared file (always as a download).
export async function GET(request: Request, { params }: Params) {
  const a = await authorize(params); if ("response" in a) return a.response;
  const who = a.who;
  void logAccess({ event: new URL(request.url).searchParams.get("view") ? "file_viewed" : "file_downloaded", side: "buyer", via: "link", personId: a.resolved.link.personId, personName: String(who.name || "Customer"), plan: { id: a.resolved.row.id, title: a.resolved.row.title }, task: { id: a.file.taskId, title: taskTitleOf(a.resolved.row.data as Record<string, unknown>, a.file.taskId) }, detail: a.file.name, dedupeMinutes: 1 });
  return pdfResponse(a.file);
}

// A customer removes a file they added themselves.
export async function DELETE(request: Request, { params }: Params) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const a = await authorize(params); if ("response" in a) return a.response;
  if (a.file.uploadedBy !== `p:${a.resolved.link.personId}`) return Response.json({ error: "You can only remove files you added" }, { status: 403 });
  await removeAttachment(a.resolved.row.id, a.file.id);
  void logAccess({ event: "file_removed", side: "buyer", via: "link", personId: a.resolved.link.personId, personName: String(a.who.name || "Customer"), plan: { id: a.resolved.row.id, title: a.resolved.row.title }, task: { id: a.file.taskId, title: taskTitleOf(a.resolved.row.data as Record<string, unknown>, a.file.taskId) }, detail: a.file.name });
  return Response.json({ ok: true });
}

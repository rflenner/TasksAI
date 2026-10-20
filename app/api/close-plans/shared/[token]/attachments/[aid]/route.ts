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
  if (!customerPerson(data, resolved.link.personId)) return { response: new Response(null, { status: 410 }) };
  const file = await loadAttachment(resolved.row.id, aid);
  if (!file || !customerSees(data, file)) return { response: new Response(null, { status: 404 }) };
  return { resolved, file };
}

// Download a shared file (always as a download).
export async function GET(_request: Request, { params }: Params) {
  const a = await authorize(params); if ("response" in a) return a.response;
  return pdfResponse(a.file);
}

// A customer removes a file they added themselves.
export async function DELETE(request: Request, { params }: Params) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const a = await authorize(params); if ("response" in a) return a.response;
  if (a.file.uploadedBy !== `p:${a.resolved.link.personId}`) return Response.json({ error: "You can only remove files you added" }, { status: 403 });
  await removeAttachment(a.resolved.row.id, a.file.id);
  return Response.json({ ok: true });
}

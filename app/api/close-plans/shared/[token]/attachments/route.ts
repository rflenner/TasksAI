import { addAttachment, customerMayAttach, customerSees, listAttachments, readUploadForm } from "../../../../../lib/close-plan-attachments";
import { resolvePlanLink } from "../../../../../lib/close-plan-links";
import { customerPerson } from "../../../../../lib/close-plan-share";
import { requireSameOrigin } from "../../../../../lib/request";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string }> };
const gone = () => Response.json({ error: "This link is no longer valid. Ask your iSEEit contact for a new one." }, { status: 410 });

// The files on the tasks shared with this customer contact (only files marked shared).
export async function GET(_request: Request, { params }: Params) {
  const resolved = await resolvePlanLink((await params).token);
  if (!resolved) return gone();
  const data = resolved.row.data as Record<string, unknown>;
  if (!customerPerson(data, resolved.link.personId)) return gone();
  return Response.json({ attachments: await listAttachments(resolved.row.id, { key: `p:${resolved.link.personId}`, admin: false }, r => customerSees(data, r)) }, { headers: { "cache-control": "no-store" } });
}

// A customer attaches a PDF to a task they may post updates on. Their files are always shared.
export async function POST(request: Request, { params }: Params) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const resolved = await resolvePlanLink((await params).token);
  if (!resolved) return gone();
  const data = resolved.row.data as Record<string, unknown>, personId = resolved.link.personId, person = customerPerson(data, personId);
  if (!person) return gone();
  const form = await readUploadForm(request);
  if ("error" in form) return Response.json({ error: form.error }, { status: form.status });
  if (!customerMayAttach(data, personId, form.taskId)) return Response.json({ error: "You can't attach files to that task." }, { status: 403 });
  const result = await addAttachment(resolved.row.id, form.taskId, form.file, true, { key: `p:${personId}`, name: String(person.name || "Customer"), side: "buyer" });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ attachment: result.meta }, { status: 201 });
}

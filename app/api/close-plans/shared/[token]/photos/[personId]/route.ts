import { resolvePlanLink } from "../../../../../../lib/close-plan-links";
import { planPhoto, photoResponse, readUpload, removeUploadedPhoto, uploadPhoto, type Person } from "../../../../../../lib/close-plan-photos";
import { customerView } from "../../../../../../lib/close-plan-share";
import { requireSameOrigin } from "../../../../../../lib/request";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string; personId: string }> };

// A person's photo on this plan, for a customer opening it through their personal link.
export async function GET(_request: Request, { params }: Params) {
  const { token, personId } = await params;
  const resolved = await resolvePlanLink(token);
  if (!resolved) return new Response(null, { status: 410 });
  return photoResponse(await planPhoto(resolved.row.id, personId));
}

// Customers can set or remove their own photo only.
async function authorize(request: Request, { params }: Params) {
  const invalid = requireSameOrigin(request); if (invalid) return { response: invalid };
  const { token, personId } = await params;
  const resolved = await resolvePlanLink(token);
  if (!resolved) return { response: Response.json({ error: "This link is no longer valid." }, { status: 410 }) };
  if (resolved.link.personId !== personId) return { response: Response.json({ error: "You can only change your own photo" }, { status: 403 }) };
  const person = ((resolved.row.data as { people?: Person[] }).people || []).find(p => p.id === personId);
  if (!person) return { response: Response.json({ error: "You are no longer on this plan" }, { status: 404 }) };
  return { planId: resolved.row.id, person };
}

export async function POST(request: Request, context: Params) {
  const auth = await authorize(request, context); if ("response" in auth) return auth.response;
  const bytes = await readUpload(request);
  if (!bytes) return Response.json({ error: "Send one picture of at most 2 MB." }, { status: 400 });
  const result = await uploadPhoto(auth.planId, auth.person, bytes);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ version: result.saved.version, plan: customerView(result.saved.data as Record<string, unknown>, auth.person.id) });
}

export async function DELETE(request: Request, context: Params) {
  const auth = await authorize(request, context); if ("response" in auth) return auth.response;
  const saved = await removeUploadedPhoto(auth.planId, auth.person.id);
  if (!saved) return Response.json({ error: "The plan is busy. Please try again." }, { status: 409 });
  return Response.json({ version: saved.version, plan: customerView(saved.data as Record<string, unknown>, auth.person.id) });
}

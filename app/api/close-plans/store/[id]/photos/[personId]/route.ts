import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { closePlanDocuments } from "../../../../../../../db/schema";
import { emailOf, planPhoto, photoResponse, readUpload, removeUploadedPhoto, uploadPhoto, type Person } from "../../../../../../lib/close-plan-photos";
import { canAccessPlan, canDeletePlan } from "../../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../../lib/request";
import { currentActor } from "../../../../../../lib/session";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; personId: string }> };

async function load(id: string) {
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  return row || null;
}
const planOut = (saved: { id: string; version: number; updatedAt: Date; data: unknown }) => ({ id: saved.id, version: saved.version, updatedAt: saved.updatedAt.toISOString(), data: saved.data });

// A person's photo on this plan (app/lib/close-plan-photos.ts), for the iSEEit team.
export async function GET(_request: Request, { params }: Params) {
  const actor = await currentActor();
  if (!actor) return new Response(null, { status: 401 });
  const { id, personId } = await params;
  const row = await load(id);
  if (!row || !canAccessPlan(actor, row)) return new Response(null, { status: 404 });
  return photoResponse(await planPhoto(id, personId));
}

// Who may set or remove a photo: the plan owner and admins for anyone, every iSEEit team member for themselves.
async function authorize(request: Request, { params }: Params) {
  const invalid = requireSameOrigin(request); if (invalid) return { response: invalid };
  const actor = await currentActor();
  if (!actor) return { response: Response.json({ error: "Sign in required" }, { status: 401 }) };
  const { id, personId } = await params;
  const row = await load(id);
  if (!row || !canAccessPlan(actor, row)) return { response: Response.json({ error: "Plan not found" }, { status: 404 }) };
  const data = row.data as { people?: Person[] };
  const person = (data.people || []).find(p => p.id === personId);
  if (!person) return { response: Response.json({ error: "That person is not on this plan" }, { status: 404 }) };
  const self = person.side === "seller" && emailOf(person) === actor.email.trim().toLowerCase();
  if (!self && !canDeletePlan(actor, data)) return { response: Response.json({ error: "Only the plan owner and admins can change other people's photos" }, { status: 403 }) };
  return { id, person };
}

export async function POST(request: Request, context: Params) {
  const auth = await authorize(request, context); if ("response" in auth) return auth.response;
  const bytes = await readUpload(request);
  if (!bytes) return Response.json({ error: "Send one picture of at most 2 MB." }, { status: 400 });
  const result = await uploadPhoto(auth.id, auth.person, bytes);
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ salesforce: result.salesforce, plan: planOut(result.saved) });
}

export async function DELETE(request: Request, context: Params) {
  const auth = await authorize(request, context); if ("response" in auth) return auth.response;
  const saved = await removeUploadedPhoto(auth.id, auth.person.id);
  if (!saved) return Response.json({ error: "The plan is busy. Please try again." }, { status: 409 });
  return Response.json({ plan: planOut(saved) });
}

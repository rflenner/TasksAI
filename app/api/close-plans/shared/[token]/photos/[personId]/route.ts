import { resolvePlanLink } from "../../../../../../lib/close-plan-links";
import { planPhoto, photoResponse } from "../../../../../../lib/close-plan-photos";

export const dynamic = "force-dynamic";

// A contact's photo on this plan, for a customer opening it through their personal link.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; personId: string }> }) {
  const { token, personId } = await params;
  const resolved = await resolvePlanLink(token);
  if (!resolved) return new Response(null, { status: 410 });
  return photoResponse(await planPhoto(resolved.row.id, personId));
}

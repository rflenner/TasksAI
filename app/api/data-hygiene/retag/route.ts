import { dimensionHygieneSummary, retagDimensionValue, type RetagType } from "../../../lib/data-hygiene";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

const VALID_TYPES: RetagType[] = ["project", "meeting", "topic", "person"];

// Renames a dimension value in place, or merges it into an existing one —
// see retagDimensionValue for why those are the same operation here. `to`
// is free text: the client sends an existing value for a merge, or a brand
// new one for a rename, and this endpoint doesn't need to tell them apart.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const { type, from, to } = await request.json() as { type?: string; from?: string; to?: string };
  if (!type || !VALID_TYPES.includes(type as RetagType)) return Response.json({ error: "Invalid dimension type" }, { status: 400 });
  if (!from?.trim() || !to?.trim()) return Response.json({ error: "Both the existing value and the new value are required" }, { status: 400 });
  try {
    const result = await retagDimensionValue(type as RetagType, from.trim(), to, actor.name);
    return Response.json({ ...result, dimensions: await dimensionHygieneSummary() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not apply that change" }, { status: 400 });
  }
}

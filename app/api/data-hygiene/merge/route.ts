import { dimensionHygieneSummary } from "../../../lib/data-hygiene";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";
import { duplicateHygieneSummary, mergeTasks } from "../../../lib/task-merge";

// Folds one task into another — site-admin-only, same gate as retag,
// and for the same reason: this is a real, mostly-irreversible data
// change (the secondary is fully hidden from the normal task list from
// here on), not something to leave open to every role.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const { primaryId, secondaryId } = await request.json() as { primaryId?: number; secondaryId?: number };
  if (!primaryId || !secondaryId) return Response.json({ error: "Both the surviving task and the one to merge in are required" }, { status: 400 });
  try {
    await mergeTasks(primaryId, secondaryId, actor.name);
    const [dimensions, { candidates, mergeHistory }] = await Promise.all([dimensionHygieneSummary(), duplicateHygieneSummary()]);
    return Response.json({ dimensions, duplicates: candidates, mergeHistory });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not merge those tasks" }, { status: 400 });
  }
}

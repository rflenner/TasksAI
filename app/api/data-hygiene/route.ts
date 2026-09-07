import { dimensionHygieneSummary } from "../../lib/data-hygiene";
import { currentActor } from "../../lib/session";
import { duplicateHygieneSummary } from "../../lib/task-merge";

export async function GET() {
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const [dimensions, { candidates, mergeHistory }] = await Promise.all([dimensionHygieneSummary(), duplicateHygieneSummary()]);
  return Response.json({ dimensions, duplicates: candidates, mergeHistory });
}

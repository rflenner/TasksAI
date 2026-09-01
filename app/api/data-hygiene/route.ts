import { dimensionHygieneSummary } from "../../lib/data-hygiene";
import { currentActor } from "../../lib/session";

export async function GET() {
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  return Response.json({ dimensions: await dimensionHygieneSummary() });
}

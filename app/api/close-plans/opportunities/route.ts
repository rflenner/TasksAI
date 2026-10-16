import { searchOpportunities } from "../../../lib/close-plan-opportunities";
import { opportunityIndex } from "../../../lib/close-plan-sales-ai";
import { currentActor } from "../../../lib/session";

// Search-as-you-type over Sales AI opportunities for the Close Plan guide.
// Admins only: the export key sees the whole pipeline, and Task AI also has
// external collaborators (customers, vendors) who must never browse it.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin" && actor.role !== "area_admin") return Response.json({ error: "Live Sales AI search is available to admins" }, { status: 403 });
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 100);
  if (q.length < 2) return Response.json({ opportunities: [] });
  try {
    const { opportunities, accountNameById } = await opportunityIndex();
    return Response.json({ opportunities: searchOpportunities(opportunities, accountNameById, q) });
  } catch (error) {
    console.error("Close Plan opportunity search failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Sales AI is not reachable right now" }, { status: 502 });
  }
}

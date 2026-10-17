import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { opportunityIdForPlan } from "../../../../../lib/close-plan-opportunities";
import { opportunityIndex } from "../../../../../lib/close-plan-sales-ai";
import { canAccessPlan } from "../../../../../lib/close-plan-store";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

// The Salesforce opportunity behind this plan, for "Open Salesforce close plan"
// (the Playground, Site Admin only). Stored on the plan when it was created from a
// Sales AI opportunity; otherwise looked up by the opportunity name the plan came from.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const { id } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, id)).limit(1);
  if (!row || row.deletedAt || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  const stored = opportunityIdForPlan(row.data, [], new Map());
  if (stored) return Response.json({ opportunityId: stored });
  try {
    const { opportunities, accountNameById } = await opportunityIndex();
    return Response.json({ opportunityId: opportunityIdForPlan(row.data, opportunities, accountNameById) });
  } catch (error) {
    console.error("Close Plan opportunity lookup failed:", error instanceof Error ? error.message : error);
    return Response.json({ opportunityId: null, error: "Sales AI is not reachable right now" });
  }
}

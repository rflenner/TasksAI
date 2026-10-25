import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanDocuments } from "../../db/schema";
import { canAccessPlan, canDeletePlan } from "./close-plan-store";
import { isOpportunityId } from "./salesforce-opportunity-search";
import { currentActor } from "./session";

// Who may read a plan's org chart from Salesforce: the plan owner and admins (same as the sync). Returns the plan's
// Salesforce opportunity id, or the error response to send.
export async function authorizeOrgChart(planId: string): Promise<{ opportunityId: string } | Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, planId), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  const data = row.data as { sfdc?: { opportunityId?: string }; sfdcOpportunityId?: string };
  if (!canDeletePlan(actor, data as Parameters<typeof canDeletePlan>[1])) return Response.json({ error: "Only the plan owner and admins can read the org chart from Salesforce" }, { status: 403 });
  const opportunityId = [data.sfdc?.opportunityId, data.sfdcOpportunityId].find((v): v is string => typeof v === "string" && isOpportunityId(v));
  if (!opportunityId) return Response.json({ error: "This plan is not linked to a Salesforce opportunity" }, { status: 400 });
  return { opportunityId };
}

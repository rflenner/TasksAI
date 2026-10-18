import { SalesforceNotConnectedError, salesforceApi } from "../../../lib/salesforce";
import { mapOpportunities, opportunitySearchSoql } from "../../../lib/salesforce-opportunity-search";
import { canCreatePlan } from "../../../lib/close-plan-store";
import { currentActor } from "../../../lib/session";

export const dynamic = "force-dynamic";

// Search-as-you-type over the connected Salesforce org's opportunities (name or
// account), for the Playground. Admins who can create close plans (also used by Import from Salesforce):
// it reads the workspace's Salesforce org with the connection from /integrations,
// not the visitor's own Salesforce access.
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!canCreatePlan(actor)) return Response.json({ error: "Admin access required" }, { status: 403 });
  const soql = opportunitySearchSoql(new URL(request.url).searchParams.get("q") || "");
  if (!soql) return Response.json({ opportunities: [] });
  try {
    const result = await salesforceApi<{ records: Parameters<typeof mapOpportunities>[0] }>(`/query?q=${encodeURIComponent(soql)}`);
    return Response.json({ opportunities: mapOpportunities(result.records || []) });
  } catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: error.message }, { status: 409 });
    console.error("Playground opportunity search failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Salesforce search failed" }, { status: 502 });
  }
}

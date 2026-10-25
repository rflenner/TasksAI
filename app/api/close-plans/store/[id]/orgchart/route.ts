import { authorizeOrgChart } from "../../../../../lib/close-plan-orgchart-access";
import { OrgChartNotFoundError, loadOrgChart } from "../../../../../lib/org-chart-load";
import { requireSameOrigin } from "../../../../../lib/request";
import { SalesforceNotConnectedError } from "../../../../../lib/salesforce";

export const dynamic = "force-dynamic";

// Preview of the org chart in Salesforce for this plan's opportunity (iseeit__Opportunity_Role__c, see app/lib/org-chart-load.ts).
// Reads Salesforce only and saves nothing, here or there. Owners of the plan and admins only, like the sync.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const access = await authorizeOrgChart((await params).id);
  if (access instanceof Response) return access;
  const { opportunityId } = access;
  try {
    const { chart } = await loadOrgChart("opportunity", opportunityId);
    return Response.json({ opportunityId, ...chart });
  } catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: "Salesforce is not connected. Connect it under Integrations." }, { status: 409 });
    if (error instanceof OrgChartNotFoundError) return Response.json({ error: "That opportunity was not found in Salesforce" }, { status: 404 });
    return Response.json({ error: "Salesforce could not be reached" }, { status: 502 });
  }
}

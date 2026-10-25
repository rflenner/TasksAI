import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { applyContactExtras, buildOrgChart, orgContactExtraQueries, orgLookupQueries, orgPhotoQuery, orgRoleQuery, type SfContactRoleRow, type SfOrgRoleRow, type SfProvisionalRow } from "../../../../../lib/close-plan-orgchart";
import { newestPhotos, type AttachmentRow } from "../../../../../lib/close-plan-photos";
import { canAccessPlan, canDeletePlan } from "../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../lib/request";
import { SalesforceNotConnectedError, salesforceApi } from "../../../../../lib/salesforce";
import { isOpportunityId } from "../../../../../lib/salesforce-opportunity-search";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;

// Preview of the org chart in Salesforce for this plan's opportunity (iseeit__Opportunity_Role__c, see app/lib/close-plan-orgchart.ts).
// Reads Salesforce only and saves nothing, here or there. Owners of the plan and admins only, like the sync.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  const data = row.data as { sfdc?: { opportunityId?: string }; sfdcOpportunityId?: string; people?: unknown };
  if (!canDeletePlan(actor, data as Parameters<typeof canDeletePlan>[1])) return Response.json({ error: "Only the plan owner and admins can read the org chart from Salesforce" }, { status: 403 });
  const opportunityId = [data.sfdc?.opportunityId, data.sfdcOpportunityId].find((v): v is string => typeof v === "string" && isOpportunityId(v));
  if (!opportunityId) return Response.json({ error: "This plan is not linked to a Salesforce opportunity" }, { status: 400 });

  try {
    const roles = await query<SfOrgRoleRow>(orgRoleQuery(opportunityId));
    const lookups = orgLookupQueries(opportunityId, roles);
    const [contactRoles, provisional] = await Promise.all([query<SfContactRoleRow>(lookups.contactRoles), lookups.provisional ? query<SfProvisionalRow>(lookups.provisional) : []]);
    const parentSql = lookups.parentContacts(new Set(contactRoles.map(r => r.ContactId)));
    const parents = parentSql ? await query<{ Id: string; Name: string | null; Title: string | null; Email: string | null }>(parentSql) : [];
    const chart = buildOrgChart(roles, contactRoles, provisional, parents);
    // Photos are a nicety: if the lookup fails the cards show initials.
    try {
      const soql = orgPhotoQuery(chart.nodes.filter(n => !n.provisional).map(n => n.key));
      const photos = soql ? newestPhotos(await query<AttachmentRow>(soql)) : new Map();
      for (const node of chart.nodes) node.photo = photos.get(node.key)?.attachmentId || "";
    } catch (error) { console.error("Close Plan org chart photos failed:", error instanceof Error ? error.message : error); }
    // Likewise the LinkedIn link and open task count.
    try {
      const extra = orgContactExtraQueries(opportunityId, chart.nodes.filter(n => !n.provisional).map(n => n.key));
      if (extra) {
        const [links, tasks, events] = await Promise.all([
          query<{ Id: string; iseeit__LinkedIn_Profile__c: string | null; iseeit__Linkedin_Profile_Url__c: string | null; iseeit__Is_Company_Left__c: boolean | null }>(extra.linkedin),
          query<{ WhoId: string; n: number }>(extra.tasks), query<{ WhoId: string; n: number }>(extra.events),
        ]);
        applyContactExtras(chart.nodes, links, [...tasks, ...events]);
      }
    } catch (error) { console.error("Close Plan org chart details failed:", error instanceof Error ? error.message : error); }
    return Response.json({ opportunityId, ...chart });
  } catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: "Salesforce is not connected. Connect it under Integrations." }, { status: 409 });
    return Response.json({ error: "Salesforce could not be reached" }, { status: 502 });
  }
}

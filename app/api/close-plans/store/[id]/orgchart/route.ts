import { applyContactExtras, buildOrgChart, orgContactExtraQueries, orgLookupQueries, orgPhotoQuery, orgRoleQuery, type SfContactRoleRow, type SfOrgRoleRow, type SfProvisionalRow } from "../../../../../lib/close-plan-orgchart";
import { newestPhotos, type AttachmentRow } from "../../../../../lib/close-plan-photos";
import { authorizeOrgChart } from "../../../../../lib/close-plan-orgchart-access";
import { requireSameOrigin } from "../../../../../lib/request";
import { isSalesforceHost } from "../../../../../lib/salesforce-domain";
import { SalesforceNotConnectedError, ensureSalesforceTokenFresh, salesforceApi } from "../../../../../lib/salesforce";

export const dynamic = "force-dynamic";

const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;

// Preview of the org chart in Salesforce for this plan's opportunity (iseeit__Opportunity_Role__c, see app/lib/close-plan-orgchart.ts).
// Reads Salesforce only and saves nothing, here or there. Owners of the plan and admins only, like the sync.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const access = await authorizeOrgChart((await params).id);
  if (access instanceof Response) return access;
  const { opportunityId } = access;

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
    // Base address for the "Go to contact" links; only ever a Salesforce-owned host.
    let salesforceBase = "";
    try { const auth = await ensureSalesforceTokenFresh(); if (auth) { const u = new URL(auth.instanceUrl); if (u.protocol === "https:" && isSalesforceHost(u.hostname)) salesforceBase = u.origin; } } catch { /* the links are optional */ }
    return Response.json({ opportunityId, salesforceBase, ...chart });
  } catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: "Salesforce is not connected. Connect it under Integrations." }, { status: 409 });
    return Response.json({ error: "Salesforce could not be reached" }, { status: 502 });
  }
}

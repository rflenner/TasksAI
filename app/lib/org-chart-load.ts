import { newestPhotos, type AttachmentRow } from "./close-plan-photos";
import {
  accountRolesToChartInput, accountRoleQuery, applyContactExtras, buildOrgChart, contactQueries, isAccountId, orgContactExtraQueries, orgLookupQueries, orgPhotoQuery, orgRoleQuery,
  type OrgChart, type SfAccountRoleRow, type SfContactRoleRow, type SfContactRow, type SfOrgRoleRow, type SfProvisionalRow,
} from "./close-plan-orgchart";
import { ensureSalesforceTokenFresh, salesforceApi } from "./salesforce";
import { isSalesforceHost } from "./salesforce-domain";
import { isOpportunityId } from "./salesforce-opportunity-search";

export type OrgChartKind = "opportunity" | "account";
export type LoadedOrgChart = { name: string; accountId: string; accountName: string; chart: OrgChart & { salesforceBase: string } };
export class OrgChartNotFoundError extends Error { constructor() { super("Not found in Salesforce"); } }

const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;

// Reads one org chart from Salesforce: an opportunity's (iseeit__Opportunity_Role__c) or an account's
// (iseeit__Account_Contact_Role__c), with each person's photo, LinkedIn link, left-company flag and open task count.
// Read-only. Photos, links and counts are a nicety: if they fail the chart still loads.
export async function loadOrgChart(kind: OrgChartKind, sfdcId: string): Promise<LoadedOrgChart> {
  if (kind === "opportunity" ? !isOpportunityId(sfdcId) : !isAccountId(sfdcId)) throw new Error("Invalid Salesforce id");
  let name = "", accountId = "", accountName = "";
  let chart: OrgChart;
  if (kind === "opportunity") {
    const [opp] = await query<{ Name: string | null; AccountId: string | null; Account?: { Name?: string | null } | null }>(`SELECT Name, AccountId, Account.Name FROM Opportunity WHERE Id = '${sfdcId}'`);
    if (!opp) throw new OrgChartNotFoundError();
    name = opp.Name || "Opportunity"; accountId = opp.AccountId || ""; accountName = opp.Account?.Name || "";
    const roles = await query<SfOrgRoleRow>(orgRoleQuery(sfdcId));
    const lookups = orgLookupQueries(sfdcId, roles);
    const [contactRoles, provisional] = await Promise.all([query<SfContactRoleRow>(lookups.contactRoles), lookups.provisional ? query<SfProvisionalRow>(lookups.provisional) : []]);
    const parentSql = lookups.parentContacts(new Set(contactRoles.map(r => r.ContactId)));
    const parents = parentSql ? await query<SfContactRow>(parentSql) : [];
    chart = buildOrgChart(roles, contactRoles, provisional, parents);
  } else {
    const [acc] = await query<{ Name: string | null }>(`SELECT Name FROM Account WHERE Id = '${sfdcId}'`);
    if (!acc) throw new OrgChartNotFoundError();
    name = accountName = acc.Name || "Account"; accountId = sfdcId;
    const rows = await query<SfAccountRoleRow>(accountRoleQuery(sfdcId));
    const wanted = [...rows.flatMap(r => [r.iseeit__Contact__c, r.iseeit__Parent_Contact__c])].filter((v): v is string => Boolean(v));
    const contacts = (await Promise.all(contactQueries(wanted).map(q => query<SfContactRow>(q)))).flat();
    const { roles, contactRoles } = accountRolesToChartInput(rows, contacts);
    const provSql = orgLookupQueries(sfdcId, roles).provisional;
    const provisional = provSql ? await query<SfProvisionalRow>(provSql) : [];
    // A manager who has a Contact but no role of their own: shown from the Contact record.
    const have = new Set(contactRoles.map(r => r.ContactId));
    chart = buildOrgChart(roles, contactRoles, provisional, contacts.filter(c => !have.has(c.Id)));
  }

  const people = chart.nodes.filter(n => !n.provisional).map(n => n.key);
  try {
    const soql = orgPhotoQuery(people);
    const photos = soql ? newestPhotos(await query<AttachmentRow>(soql)) : new Map();
    for (const node of chart.nodes) node.photo = photos.get(node.key)?.attachmentId || "";
  } catch (error) { console.error("Org chart photos failed:", error instanceof Error ? error.message : error); }
  try {
    const extra = orgContactExtraQueries(kind === "opportunity" ? sfdcId : accountId, people);
    if (extra) {
      const [links, tasks, events] = await Promise.all([
        query<{ Id: string; iseeit__LinkedIn_Profile__c: string | null; iseeit__Linkedin_Profile_Url__c: string | null; iseeit__Is_Company_Left__c: boolean | null }>(extra.linkedin),
        query<{ WhoId: string; n: number }>(extra.tasks), query<{ WhoId: string; n: number }>(extra.events),
      ]);
      applyContactExtras(chart.nodes, links, [...tasks, ...events]);
    }
  } catch (error) { console.error("Org chart details failed:", error instanceof Error ? error.message : error); }

  let salesforceBase = "";
  try { const auth = await ensureSalesforceTokenFresh(); if (auth) { const u = new URL(auth.instanceUrl); if (u.protocol === "https:" && isSalesforceHost(u.hostname)) salesforceBase = u.origin; } } catch { /* the links are optional */ }
  return { name, accountId, accountName, chart: { ...chart, salesforceBase } };
}

// Org chart of an opportunity in Salesforce (the iSEEit package), read-only for now. Pure: no DB, no network.
//
// Shape checked against the iSEEit org on 2026-10-25:
//  - iseeit__Opportunity_Role__c has one row per person on the opportunity's org chart.
//  - The person is the standard OpportunityContactRole in iseeit__OpportunityContactRole__c (00K…), or, for someone who
//    is not a Contact yet, a iseeit__Provisional_Contact__c in iseeit__Provisional_Contact__c (a1C…).
//  - The manager is iseeit__Parent_Contact__c (a Contact Id, despite its label "Contact") or iseeit__Parent_Provisional_Contact__c.
//    No manager means top of the chart.
//  - iseeit__Child_Number__c is the order among siblings. iseeit__Child_Count__c is denormalised and can drift (it has been -1),
//    so it is never used here.
import { isSalesforceId } from "./salesforce-checkpoints";

export type SfOrgRoleRow = {
  Id: string;
  iseeit__OpportunityContactRole__c: string | null;
  iseeit__Provisional_Contact__c: string | null;
  iseeit__Parent_Contact__c: string | null;
  iseeit__Parent_Provisional_Contact__c: string | null;
  iseeit__Type__c: string | null;
  iseeit__Title__c: string | null;
  iseeit__Power_Base__c: boolean | null;
  iseeit__Child_Number__c: number | null;
  iseeit__Is_Org_Chart_Persona__c?: boolean | null;
};
export type SfContactRoleRow = { Id: string; ContactId: string; Role: string | null; Contact: { Name: string | null; Title: string | null; Email: string | null } | null };
export type SfProvisionalRow = { Id: string; Name: string | null; iseeit__Title__c: string | null };

export type OrgNode = {
  key: string; // Contact Id (003…) or provisional contact Id (a1C…): what the parent fields point to
  roleId: string; // iseeit__Opportunity_Role__c Id
  name: string;
  title: string;
  email: string;
  provisional: boolean;
  type: string; // Champion, Coach, Enemy, Influencer, Neutral
  dealRole: string; // the standard Contact Role on the opportunity
  powerBase: boolean;
  parentKey: string | null;
  order: number;
  linkedin: string; // the Contact's LinkedIn profile link, or ""
  left: boolean; // Salesforce says the Contact has left the company (iseeit__Is_Company_Left__c)
  openTasks: number; // open Tasks plus upcoming Events on this opportunity with the Contact
  photo: string; // Salesforce Attachment Id of the Contact's Profile_Picture.jpg, or "" (set by the route, see close-plan-photos.ts)
};
export type OrgChartIssue = { kind: "duplicate" | "unknown-person" | "parent-missing" | "cycle" | "persona"; roleId: string; text: string };
export type OrgChart = { nodes: OrgNode[]; roots: string[]; issues: OrgChartIssue[] };

const ids = (list: Array<string | null | undefined>) => [...new Set(list.filter((v): v is string => typeof v === "string" && isSalesforceId(v)))];
const inList = (list: string[]) => list.map(id => `'${id}'`).join(",");

export function orgRoleQuery(opportunityId: string) {
  return `SELECT Id, iseeit__OpportunityContactRole__c, iseeit__Provisional_Contact__c, iseeit__Parent_Contact__c, iseeit__Parent_Provisional_Contact__c, iseeit__Type__c, iseeit__Title__c, iseeit__Power_Base__c, iseeit__Child_Number__c, iseeit__Is_Org_Chart_Persona__c FROM iseeit__Opportunity_Role__c WHERE iseeit__Opportunity__c = '${opportunityId}' ORDER BY iseeit__Child_Number__c, CreatedDate LIMIT 2000`;
}

// Follow-up lookups for the ids a role query returned (null when there is nothing to ask).
export function orgLookupQueries(opportunityId: string, roles: SfOrgRoleRow[]) {
  const provisional = ids(roles.flatMap(r => [r.iseeit__Provisional_Contact__c, r.iseeit__Parent_Provisional_Contact__c]));
  return {
    contactRoles: `SELECT Id, ContactId, Role, Contact.Name, Contact.Title, Contact.Email FROM OpportunityContactRole WHERE OpportunityId = '${opportunityId}' LIMIT 2000`,
    // A parent can be a Contact that has no role of its own on this opportunity.
    parentContacts: (known: Set<string>) => {
      const missing = ids(roles.map(r => r.iseeit__Parent_Contact__c)).filter(id => !known.has(id));
      return missing.length ? `SELECT Id, Name, Title, Email FROM Contact WHERE Id IN (${inList(missing)})` : null;
    },
    provisional: provisional.length ? `SELECT Id, Name, iseeit__Title__c FROM iseeit__Provisional_Contact__c WHERE Id IN (${inList(provisional)})` : null,
  };
}

type ContactInfo = { Id: string; Name: string | null; Title: string | null; Email: string | null };

export function buildOrgChart(roles: SfOrgRoleRow[], contactRoles: SfContactRoleRow[], provisional: SfProvisionalRow[], parentContacts: ContactInfo[] = []): OrgChart {
  const issues: OrgChartIssue[] = [];
  const ocrById = new Map(contactRoles.map(r => [r.Id, r]));
  const provisionalById = new Map(provisional.map(p => [p.Id, p]));
  const nodes = new Map<string, OrgNode>();
  const unknown: string[] = [];
  const duplicates = new Map<string, { roleId: string; extra: number }>();

  for (const role of roles) {
    if (role.iseeit__Is_Org_Chart_Persona__c) { issues.push({ kind: "persona", roleId: role.Id, text: "Persona template entry, left out" }); continue; }
    const ocr = role.iseeit__OpportunityContactRole__c ? ocrById.get(role.iseeit__OpportunityContactRole__c) : undefined;
    const prov = role.iseeit__Provisional_Contact__c ? provisionalById.get(role.iseeit__Provisional_Contact__c) : undefined;
    const key = ocr?.ContactId || (prov ? prov.Id : null);
    if (!key) { unknown.push(role.Id); continue; }
    if (nodes.has(key)) { const d = duplicates.get(key) || { roleId: role.Id, extra: 0 }; d.extra++; duplicates.set(key, d); continue; }
    nodes.set(key, {
      key, roleId: role.Id, provisional: !ocr,
      name: (ocr ? ocr.Contact?.Name : prov?.Name) || "(no name)",
      title: role.iseeit__Title__c || (ocr ? ocr.Contact?.Title : prov?.iseeit__Title__c) || "",
      email: ocr?.Contact?.Email || "",
      type: role.iseeit__Type__c || "", dealRole: ocr?.Role || "", powerBase: Boolean(role.iseeit__Power_Base__c),
      parentKey: role.iseeit__Parent_Contact__c || role.iseeit__Parent_Provisional_Contact__c || null,
      order: role.iseeit__Child_Number__c ?? 0, photo: "", linkedin: "", left: false, openTasks: 0,
    });
  }

  // One line per person or kind of problem, not one per row: a real chart can repeat the same person many times.
  for (const [key, d] of duplicates) issues.push({ kind: "duplicate", roleId: d.roleId, text: `${nodes.get(key)!.name} is in the org chart ${d.extra + 1} times, the first entry is used` });
  if (unknown.length) issues.push({ kind: "unknown-person", roleId: unknown[0], text: `${unknown.length} ${unknown.length === 1 ? "entry has" : "entries have"} no contact or provisional contact in Salesforce, left out` });
  // A manager who has no entry of their own: show them as a node if we know who they are, otherwise the person becomes a top-level entry.
  for (const contact of parentContacts) {
    if (nodes.has(contact.Id) || ![...nodes.values()].some(n => n.parentKey === contact.Id)) continue;
    nodes.set(contact.Id, { key: contact.Id, roleId: "", name: contact.Name || "(no name)", title: contact.Title || "", email: contact.Email || "", provisional: false, type: "", dealRole: "", powerBase: false, parentKey: null, order: -1, photo: "", linkedin: "", left: false, openTasks: 0 });
    issues.push({ kind: "parent-missing", roleId: "", text: `${contact.Name || contact.Id} is a manager in the chart but has no role of their own on the opportunity` });
  }
  for (const node of nodes.values()) {
    if (node.parentKey && !nodes.has(node.parentKey)) {
      issues.push({ kind: "parent-missing", roleId: node.roleId, text: `${node.name}'s manager is not on this opportunity, so they are shown at the top` });
      node.parentKey = null;
    }
  }
  // Break loops (A reports to B reports to A) so every node is reachable from a root.
  for (const start of nodes.values()) {
    const seen = new Set<string>();
    for (let n: OrgNode | undefined = start; n; n = n.parentKey ? nodes.get(n.parentKey) : undefined) {
      if (seen.has(n.key)) {
        issues.push({ kind: "cycle", roleId: start.roleId, text: `${start.name} is part of a reporting loop, shown at the top` });
        start.parentKey = null;
        break;
      }
      seen.add(n.key);
    }
  }

  const sorted = [...nodes.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { nodes: sorted, roots: sorted.filter(n => !n.parentKey).map(n => n.key), issues };
}

// Per Contact on the chart: the LinkedIn link and the number of open Tasks and upcoming Events on this opportunity
// (what the Salesforce chart's clipboard counter shows). Both are read after the chart is built.
export function orgContactExtraQueries(opportunityId: string, contactIds: string[]) {
  const list = ids(contactIds);
  if (!list.length) return null;
  const who = `WhoId IN (${inList(list)})`;
  return {
    linkedin: `SELECT Id, iseeit__LinkedIn_Profile__c, iseeit__Linkedin_Profile_Url__c, iseeit__Is_Company_Left__c FROM Contact WHERE Id IN (${inList(list)})`,
    tasks: `SELECT WhoId, COUNT(Id) n FROM Task WHERE WhatId = '${opportunityId}' AND IsClosed = false AND ${who} GROUP BY WhoId`,
    events: `SELECT WhoId, COUNT(Id) n FROM Event WHERE WhatId = '${opportunityId}' AND ActivityDateTime >= TODAY AND ${who} GROUP BY WhoId`,
  };
}

// Only a real LinkedIn address is ever linked to: the field is free text.
export function linkedinUrl(...candidates: Array<string | null | undefined>): string {
  for (const raw of candidates) {
    const text = (raw || "").trim().split(/\s+/)[0];
    if (!text) continue;
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      if (/^https?:$/.test(url.protocol) && /(^|\.)linkedin\.com$/i.test(url.hostname)) { url.protocol = "https:"; return url.toString(); }
    } catch { /* not a link */ }
  }
  return "";
}

export function applyContactExtras(nodes: OrgNode[], linkedin: Array<{ Id: string; iseeit__LinkedIn_Profile__c: string | null; iseeit__Linkedin_Profile_Url__c: string | null; iseeit__Is_Company_Left__c?: boolean | null }>, counts: Array<{ WhoId: string; n: number }>) {
  const links = new Map(linkedin.map(c => [c.Id, linkedinUrl(c.iseeit__LinkedIn_Profile__c, c.iseeit__Linkedin_Profile_Url__c)]));
  const gone = new Set(linkedin.filter(c => c.iseeit__Is_Company_Left__c).map(c => c.Id));
  const open = new Map<string, number>();
  for (const c of counts) open.set(c.WhoId, (open.get(c.WhoId) || 0) + Number(c.n || 0));
  for (const node of nodes) { if (node.provisional) continue; node.linkedin = links.get(node.key) || ""; node.left = gone.has(node.key); node.openTasks = open.get(node.key) || 0; }
}

// The Contact's profile picture, the same files the Salesforce chart shows (it takes any attachment named Profile_Picture…).
export function orgPhotoQuery(contactIds: string[]): string | null {
  const list = ids(contactIds).slice(0, 200);
  return list.length ? `SELECT Id, ParentId, LastModifiedDate FROM Attachment WHERE Name LIKE 'Profile_Picture%' AND ParentId IN (${inList(list)}) ORDER BY LastModifiedDate DESC` : null;
}

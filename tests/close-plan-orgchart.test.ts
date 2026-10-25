import assert from "node:assert/strict";
import test from "node:test";
import { buildOrgChart, orgLookupQueries, orgRoleQuery, type SfContactRoleRow, type SfOrgRoleRow } from "../app/lib/close-plan-orgchart";

// Fictional data only — this repository is public.
const role = (id: string, over: Partial<SfOrgRoleRow>): SfOrgRoleRow => ({ Id: id, iseeit__OpportunityContactRole__c: null, iseeit__Provisional_Contact__c: null, iseeit__Parent_Contact__c: null, iseeit__Parent_Provisional_Contact__c: null, iseeit__Type__c: null, iseeit__Title__c: null, iseeit__Power_Base__c: false, iseeit__Child_Number__c: 0, ...over });
const ocr = (id: string, contactId: string, name: string, over: Partial<SfContactRoleRow> = {}): SfContactRoleRow => ({ Id: id, ContactId: contactId, Role: null, Contact: { Name: name, Title: "Head of Ops", Email: `${name.split(" ")[0].toLowerCase()}@example.com` }, ...over });

const contactRoles = [ocr("00K000000000001AAA", "003000000000001AAA", "Ana Lopez"), ocr("00K000000000002AAA", "003000000000002AAA", "Ben Ito", { Role: "Champion" }), ocr("00K000000000003AAA", "003000000000003AAA", "Cy Dunn")];

test("builds the tree from manager links, ordered among siblings", () => {
  const chart = buildOrgChart([
    role("a0O000000000001AAA", { iseeit__OpportunityContactRole__c: "00K000000000001AAA" }),
    role("a0O000000000002AAA", { iseeit__OpportunityContactRole__c: "00K000000000002AAA", iseeit__Parent_Contact__c: "003000000000001AAA", iseeit__Child_Number__c: 1, iseeit__Power_Base__c: true, iseeit__Type__c: "Coach" }),
    role("a0O000000000003AAA", { iseeit__OpportunityContactRole__c: "00K000000000003AAA", iseeit__Parent_Contact__c: "003000000000001AAA", iseeit__Child_Number__c: 0, iseeit__Title__c: "CFO" }),
  ], contactRoles, []);
  assert.deepEqual(chart.roots, ["003000000000001AAA"]);
  assert.deepEqual(chart.nodes.filter(n => n.parentKey).map(n => n.name), ["Cy Dunn", "Ben Ito"]);
  const ben = chart.nodes.find(n => n.name === "Ben Ito")!;
  assert.equal(ben.dealRole, "Champion"); assert.equal(ben.powerBase, true); assert.equal(ben.type, "Coach");
  assert.equal(chart.nodes.find(n => n.name === "Cy Dunn")!.title, "CFO");
  assert.deepEqual(chart.issues, []);
});

test("provisional contacts are people too, and can be managers", () => {
  const chart = buildOrgChart([
    role("a0O000000000001AAA", { iseeit__Provisional_Contact__c: "a1C000000000001AAA" }),
    role("a0O000000000002AAA", { iseeit__OpportunityContactRole__c: "00K000000000001AAA", iseeit__Parent_Provisional_Contact__c: "a1C000000000001AAA" }),
  ], contactRoles, [{ Id: "a1C000000000001AAA", Name: "Dee Fox", iseeit__Title__c: "VP" }]);
  assert.deepEqual(chart.roots, ["a1C000000000001AAA"]);
  assert.equal(chart.nodes.find(n => n.name === "Dee Fox")!.provisional, true);
  assert.equal(chart.nodes.find(n => n.name === "Ana Lopez")!.parentKey, "a1C000000000001AAA");
});

test("loops, missing managers, duplicates and empty entries are reported, never thrown", () => {
  const chart = buildOrgChart([
    role("a0O000000000001AAA", { iseeit__OpportunityContactRole__c: "00K000000000001AAA", iseeit__Parent_Contact__c: "003000000000002AAA" }),
    role("a0O000000000002AAA", { iseeit__OpportunityContactRole__c: "00K000000000002AAA", iseeit__Parent_Contact__c: "003000000000001AAA" }),
    role("a0O000000000003AAA", { iseeit__OpportunityContactRole__c: "00K000000000003AAA", iseeit__Parent_Contact__c: "003000000000009AAA" }),
    role("a0O000000000004AAA", { iseeit__OpportunityContactRole__c: "00K000000000003AAA" }),
    role("a0O000000000005AAA", {}),
  ], contactRoles, []);
  assert.deepEqual(new Set(chart.issues.map(i => i.kind)), new Set(["cycle", "parent-missing", "duplicate", "unknown-person"]));
  // Every node can be reached from a root.
  const byParent = new Map<string | null, string[]>();
  for (const n of chart.nodes) byParent.set(n.parentKey, [...(byParent.get(n.parentKey) || []), n.key]);
  const reached = new Set<string>(); const walk = (k: string) => { reached.add(k); (byParent.get(k) || []).forEach(walk); };
  chart.roots.forEach(walk);
  assert.equal(reached.size, chart.nodes.length);
});

test("a manager without a role of their own is added from their Contact record", () => {
  const roles = [role("a0O000000000001AAA", { iseeit__OpportunityContactRole__c: "00K000000000001AAA", iseeit__Parent_Contact__c: "003000000000009AAA" })];
  const parentSql = orgLookupQueries("006000000000001AAA", roles).parentContacts(new Set(["003000000000001AAA"]));
  assert.ok(parentSql?.includes("IN ('003000000000009AAA')"));
  const chart = buildOrgChart(roles, contactRoles, [], [{ Id: "003000000000009AAA", Name: "Eli Park", Title: "COO", Email: null }]);
  assert.equal(chart.nodes.find(n => n.name === "Ana Lopez")!.parentKey, "003000000000009AAA");
  assert.deepEqual(chart.roots, ["003000000000009AAA"]);
});

test("queries only embed Salesforce ids", () => {
  assert.ok(orgRoleQuery("006000000000001AAA").includes("= '006000000000001AAA'"));
  const q = orgLookupQueries("006000000000001AAA", [role("x", { iseeit__Provisional_Contact__c: "a1C' OR Name != '", iseeit__Parent_Provisional_Contact__c: "a1C000000000001AAA" })]);
  assert.ok(q.provisional?.includes("IN ('a1C000000000001AAA')") && !q.provisional.includes("OR Name"));
});

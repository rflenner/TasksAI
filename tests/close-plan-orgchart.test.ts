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

test("LinkedIn links: only real linkedin.com addresses, with or without https", async () => {
  const { linkedinUrl, applyContactExtras, orgContactExtraQueries, orgPhotoQuery } = await import("../app/lib/close-plan-orgchart");
  assert.equal(linkedinUrl("https://www.linkedin.com/in/ana-lopez"), "https://www.linkedin.com/in/ana-lopez");
  assert.equal(linkedinUrl("linkedin.com/in/ana-lopez"), "https://linkedin.com/in/ana-lopez");
  assert.equal(linkedinUrl("javascript:alert(1)"), "");
  assert.equal(linkedinUrl("https://evil.example.com/linkedin.com"), "");
  assert.equal(linkedinUrl("http://linkedin.com/in/x"), "https://linkedin.com/in/x");
  assert.equal(linkedinUrl(null, "  https://linkedin.com/in/b  "), "https://linkedin.com/in/b");
  assert.equal(linkedinUrl(""), "");
  const chart = buildOrgChart([role("a0O000000000001AAA", { iseeit__OpportunityContactRole__c: "00K000000000001AAA" }), role("a0O000000000002AAA", { iseeit__Provisional_Contact__c: "a1C000000000001AAA" })], contactRoles, [{ Id: "a1C000000000001AAA", Name: "Dee Fox", iseeit__Title__c: null }]);
  applyContactExtras(chart.nodes, [{ Id: "003000000000001AAA", iseeit__LinkedIn_Profile__c: "linkedin.com/in/ana", iseeit__Linkedin_Profile_Url__c: null, iseeit__Is_Company_Left__c: true }], [{ WhoId: "003000000000001AAA", n: 2 }, { WhoId: "003000000000001AAA", n: 1 }]);
  const ana = chart.nodes.find(n => n.name === "Ana Lopez")!, dee = chart.nodes.find(n => n.name === "Dee Fox")!;
  assert.equal(ana.openTasks, 3); assert.equal(ana.linkedin, "https://linkedin.com/in/ana");
  assert.equal(ana.left, true); assert.equal(dee.left, false);
  assert.equal(dee.openTasks, 0); assert.equal(dee.linkedin, "");
  const q = orgContactExtraQueries("006000000000001AAA", ["003000000000001AAA", "x' OR 1=1"])!;
  assert.ok(q.tasks.includes("IN ('003000000000001AAA')") && !q.events.includes("OR 1=1"));
  assert.equal(orgContactExtraQueries("006000000000001AAA", []), null);
  assert.ok(orgPhotoQuery(["003000000000001AAA"])?.includes("LIKE 'Profile_Picture%'"));
});

test("task list queries only embed Salesforce ids, and tasks and events merge by date", async () => {
  const { orgTaskQueries, mapOrgTasks } = await import("../app/lib/close-plan-orgchart");
  const q = orgTaskQueries("006000000000001AAA", "003000000000001AAA")!;
  assert.ok(q.tasks.includes("WhoId = '003000000000001AAA'") && q.tasks.includes("IsClosed = false") && q.events.includes("ActivityDateTime >= TODAY"));
  assert.equal(orgTaskQueries("006000000000001AAA", "x' OR 1=1"), null);
  assert.equal(orgTaskQueries("bad", "003000000000001AAA"), null);
  const items = mapOrgTasks(
    [{ Id: "00T1", Subject: "Send contract", ActivityDate: "2026-11-02", Status: "Not Started", Owner: { Name: "Sam" } }, { Id: "00T2", Subject: null, ActivityDate: null, Status: null }],
    [{ Id: "00U1", Subject: "Demo", ActivityDateTime: "2026-10-30T09:00:00.000+0000", Owner: { Name: "Ana" } }]);
  assert.deepEqual(items.map(i => [i.kind, i.subject, i.when]), [["Event", "Demo", "2026-10-30"], ["Task", "Send contract", "2026-11-02"], ["Task", "(no subject)", ""]]);
});

test("an account's org chart is built from its contact roles", async () => {
  const { accountRolesToChartInput, accountRoleQuery, contactQueries, orgSearchSoql, isAccountId } = await import("../app/lib/close-plan-orgchart");
  const rows = [
    { Id: "a0q000000000001AAA", iseeit__Contact__c: "003000000000001AAA", iseeit__Provisional_Contact__c: null, iseeit__Parent_Contact__c: null, iseeit__Parent_Provisional_Contact__c: null, iseeit__Type__c: "Champion", iseeit__Title__c: null, iseeit__Power_Base__c: true, iseeit__Child_Number__c: 0, iseeit__Description__c: "Sponsor" },
    { Id: "a0q000000000002AAA", iseeit__Contact__c: "003000000000002AAA", iseeit__Provisional_Contact__c: null, iseeit__Parent_Contact__c: "003000000000001AAA", iseeit__Parent_Provisional_Contact__c: null, iseeit__Type__c: null, iseeit__Title__c: "Head of Ops", iseeit__Power_Base__c: false, iseeit__Child_Number__c: 1, iseeit__Description__c: null },
    { Id: "a0q000000000003AAA", iseeit__Contact__c: null, iseeit__Provisional_Contact__c: null, iseeit__Parent_Contact__c: "003000000000001AAA", iseeit__Parent_Provisional_Contact__c: null, iseeit__Type__c: null, iseeit__Title__c: null, iseeit__Power_Base__c: false, iseeit__Child_Number__c: 2, iseeit__Description__c: null },
  ];
  const contacts = [{ Id: "003000000000001AAA", Name: "Ana Lopez", Title: "COO", Email: "ana@example.com", Phone: null }, { Id: "003000000000002AAA", Name: "Ben Ito", Title: "Ops", Email: null }];
  const { roles, contactRoles } = accountRolesToChartInput(rows, contacts);
  const chart = buildOrgChart(roles, contactRoles, []);
  assert.deepEqual(chart.roots, ["003000000000001AAA"]);
  const ben = chart.nodes.find(n => n.name === "Ben Ito")!;
  assert.equal(ben.parentKey, "003000000000001AAA"); assert.equal(ben.title, "Head of Ops");
  assert.equal(chart.nodes.find(n => n.name === "Ana Lopez")!.description, "Sponsor");
  assert.deepEqual(chart.issues.map(i => i.kind), ["unknown-person"]);
  assert.ok(accountRoleQuery("001000000000001AAA").includes("iseeit__Account__c = '001000000000001AAA'"));
  assert.equal(contactQueries(["003000000000001AAA", "003000000000002AAA", "bad' OR 1=1"], 1).length, 2);
  assert.ok(!contactQueries(["bad' OR 1=1"]).length);
  assert.ok(orgSearchSoql("account", "Dyna trace")!.includes("Name LIKE '%Dyna%' AND Name LIKE '%trace%'"));
  assert.ok(!orgSearchSoql("opportunity", "x' OR Name != '")!.includes("OR Name != '"));
  assert.equal(orgSearchSoql("account", "a"), null);
  assert.equal(isAccountId("00106000023pfLMAAY"), true); assert.equal(isAccountId("006000000000001AAA"), false);
});

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

test("org chart edits: move, loops, reorder, add, remove", async () => {
  const { applyOrgEdit } = await import("../app/lib/org-chart-edit");
  const node = (key: string, parentKey: string | null, order: number) => ({ key, roleId: "r" + key, name: key.toUpperCase(), title: "", email: "", phone: "", description: "", provisional: false, type: "Neutral", dealRole: "", powerBase: false, parentKey, order, linkedin: "", left: false, openTasks: 0, photo: "" });
  const chart = { nodes: [node("a", null, 0), node("b", "a", 0), node("c", "b", 0), node("d", "a", 1)], roots: ["a"], issues: [] };
  const ok = (r: ReturnType<typeof applyOrgEdit>) => { assert.ok(!("error" in r), "error" in r ? r.error : ""); return (r as { chart: typeof chart }).chart; };
  assert.match((applyOrgEdit(chart, { op: "move", key: "a", parentKey: "c" }) as { error: string }).error, /loop/);
  assert.match((applyOrgEdit(chart, { op: "move", key: "a", parentKey: "a" }) as { error: string }).error, /themselves/);
  const moved = ok(applyOrgEdit(chart, { op: "move", key: "c", parentKey: "d" }));
  assert.equal(moved.nodes.find(n => n.key === "c")!.parentKey, "d");
  const top = ok(applyOrgEdit(chart, { op: "move", key: "d", parentKey: null }));
  assert.deepEqual(top.roots.sort(), ["a", "d"]);
  const shifted = ok(applyOrgEdit(chart, { op: "shift", key: "d", by: -1 }));
  assert.deepEqual(shifted.nodes.filter(n => n.parentKey === "a").map(n => n.key), ["d", "b"]);
  const added = applyOrgEdit(chart, { op: "add", name: "  New  Person ", title: "CFO", parentKey: "a" }) as { chart: typeof chart; key: string };
  assert.equal(added.chart.nodes.find(n => n.key === added.key)!.name, "New Person");
  assert.equal(added.chart.nodes.find(n => n.key === added.key)!.provisional, true);
  assert.ok("error" in applyOrgEdit(chart, { op: "add", name: "  ", parentKey: null }));
  const removed = ok(applyOrgEdit(chart, { op: "remove", key: "b" }));
  assert.equal(removed.nodes.find(n => n.key === "c")!.parentKey, "a");
  assert.deepEqual(removed.nodes.filter(n => n.parentKey === "a").map(n => n.key), ["c", "d"]);
  assert.ok(!removed.nodes.some(n => n.key === "b"));
  assert.ok("error" in applyOrgEdit(chart, { op: "update", key: "a", type: "Boss" }));
  assert.equal(ok(applyOrgEdit(chart, { op: "update", key: "a", type: "Champion", powerBase: true })).nodes[0].type, "Champion");
});

test("org chart drop zones: above, below, beside, with or without the team", async () => {
  const { applyOrgEdit } = await import("../app/lib/org-chart-edit");
  const node = (key: string, parentKey: string | null, order: number) => ({ key, roleId: "r" + key, name: key.toUpperCase(), title: "", email: "", phone: "", description: "", provisional: false, type: "Neutral", dealRole: "", powerBase: false, parentKey, order, linkedin: "", left: false, openTasks: 0, photo: "" });
  // a -> (b -> c, d), e (top level)
  const chart = { nodes: [node("a", null, 0), node("e", null, 1), node("b", "a", 0), node("d", "a", 1), node("c", "b", 0)], roots: ["a", "e"], issues: [] };
  type C = typeof chart;
  const run = (key: string, targetKey: string | null, position: "top" | "bottom" | "left" | "right" | "root", withTeam: boolean) => applyOrgEdit(chart, { op: "drop", key, targetKey, position, withTeam });
  const ok = (r: ReturnType<typeof run>) => { assert.ok(!("error" in r), "error" in r ? r.error : ""); return (r as { chart: C }).chart; };
  const kids = (c: C, p: string | null) => c.nodes.filter(n => n.parentKey === p).sort((x, y) => x.order - y.order).map(n => n.key);
  // beside: d left of b, then e right of a at top level
  assert.deepEqual(kids(ok(run("d", "b", "left", true)), "a"), ["d", "b"]);
  assert.deepEqual(kids(ok(run("d", "b", "right", true)), "a"), ["b", "d"]);
  assert.deepEqual(ok(run("c", "a", "right", true)).roots, ["a", "c", "e"]);
  // below: c under d
  assert.equal(ok(run("c", "d", "bottom", true)).nodes.find(n => n.key === "c")!.parentKey, "d");
  // above: e becomes the manager of a; e takes a's place
  const above = ok(run("e", "a", "top", true));
  assert.deepEqual(above.roots, ["e"]);
  assert.equal(above.nodes.find(n => n.key === "a")!.parentKey, "e");
  // above a middle manager: d above b -> d reports to a, b reports to d, c stays with b
  const mid = ok(run("d", "b", "top", true));
  assert.deepEqual(kids(mid, "a"), ["d"]);
  assert.deepEqual(kids(mid, "d"), ["b"]);
  assert.deepEqual(kids(mid, "b"), ["c"]);
  // with team: a manager cannot land inside their own team; alone it can, and the team moves up
  assert.match((run("b", "c", "bottom", true) as { error: string }).error, /team/);
  const alone = ok(run("b", "c", "bottom", false));
  assert.equal(alone.nodes.find(n => n.key === "c")!.parentKey, "a");
  assert.equal(alone.nodes.find(n => n.key === "b")!.parentKey, "c");
  // moving alone takes the team up; with the team it travels along
  assert.deepEqual(kids(ok(run("b", "e", "bottom", false)), "a"), ["c", "d"]);
  assert.deepEqual(kids(ok(run("b", "e", "bottom", true)), "b"), ["c"]);
  // top level, and bad input
  assert.deepEqual(ok(run("b", null, "root", false)).roots, ["a", "e", "b"]);
  assert.ok("error" in run("a", "a", "top", true));
  assert.ok("error" in run("a", "e", "root", true));
  assert.ok("error" in run("a", null, "left", true));
});

test("team layout rules: row, ladder, deep levels, wide teams, manual override", async () => {
  const { planTeam } = await import("../app/lib/org-chart-layout");
  const person = (key: string, parentKey: string | null, extra: Record<string, unknown> = {}) => ({ key, roleId: "", name: key, title: "", email: "", phone: "", description: "", provisional: false, type: "Neutral", dealRole: "", powerBase: false, parentKey, order: 0, linkedin: "", left: false, openTasks: 0, photo: "", ...extra }) as import("../app/lib/close-plan-orgchart").OrgNode;
  const make = (people: ReturnType<typeof person>[]) => { const by = new Map<string, ReturnType<typeof person>[]>(); for (const p of people) by.set(p.parentKey || "", [...(by.get(p.parentKey || "") || []), p]); return (k: string) => by.get(k) || []; };
  const boss = person("m", null);
  const leaves = (n: number) => Array.from({ length: n }, (_, i) => person("l" + i, "m"));
  // 1 and 2: three leaves hang, two stay in a row
  assert.equal(planTeam(boss, 1, make([boss, ...leaves(3)])).layout, "ladder");
  assert.equal(planTeam(boss, 1, make([boss, ...leaves(2)])).layout, "row");
  // a team where someone leads stays a row at the top, even when small
  const lead = [boss, person("a", "m"), person("b", "m"), person("c", "m"), person("a1", "a")];
  assert.equal(planTeam(boss, 1, make(lead)).layout, "row");
  // 3: from level 4 down it hangs although someone leads
  assert.equal(planTeam(boss, 3, make(lead)).layout, "ladder");
  assert.equal(planTeam(boss, 2, make(lead)).layout, "row");
  // 4: more than six with leaders: leaders stay in the row, leaves hang together
  const wide = [boss, ...Array.from({ length: 8 }, (_, i) => person("w" + i, "m")), person("w0x", "w0")];
  const plan = planTeam(boss, 1, make(wide));
  assert.equal(plan.layout, "row"); assert.deepEqual(plan.row.map(n => n.key), ["w0"]); assert.equal(plan.ladder.length, 7);
  // 5: manual choice beats the rules
  assert.equal(planTeam(person("m", null, { layout: "row" }), 3, make([boss, ...leaves(5)])).layout, "row");
  assert.equal(planTeam(person("m", null, { layout: "ladder" }), 1, make(lead)).layout, "ladder");
  assert.equal(planTeam(person("m", null, { layout: "auto" }), 1, make([boss, ...leaves(4)])).layout, "ladder");
  const { applyOrgEdit } = await import("../app/lib/org-chart-edit");
  const chart = { nodes: [boss], roots: ["m"], issues: [] };
  assert.equal((applyOrgEdit(chart, { op: "update", key: "m", layout: "ladder" }) as { chart: typeof chart }).chart.nodes[0].layout, "ladder");
  assert.ok("error" in applyOrgEdit(chart, { op: "update", key: "m", layout: "diagonal" }));
});

test("comparing two copies of a chart lists who is new, gone or has a new manager", async () => {
  const { diffOrgCharts } = await import("../app/lib/org-chart-edit");
  const person = (key: string, parentKey: string | null) => ({ key, roleId: "", name: key.toUpperCase(), title: "", email: "", phone: "", description: "", provisional: false, type: "Neutral", dealRole: "", powerBase: false, parentKey, order: 0, linkedin: "", left: false, openTasks: 0, photo: "" });
  const before = { nodes: [person("a", null), person("b", "a"), person("c", "a")], roots: ["a"], issues: [] };
  const after = { nodes: [person("a", null), person("b", null), person("d", "a")], roots: ["a", "b"], issues: [] };
  assert.deepEqual(diffOrgCharts(before, after), { added: ["D"], removed: ["C"], moved: ["B"], same: false });
  assert.equal(diffOrgCharts(before, before).same, true);
});

test("influence lines: one direction, no duplicates, kept only for people still in the chart", async () => {
  const { applyInfluenceEdit, keepInfluences } = await import("../app/lib/org-chart-influence");
  const people = new Map([["a", "Ada"], ["b", "Ben"], ["c", "Cy"]]);
  const added = applyInfluenceEdit([], people, { op: "add", from: "a", to: "b", strength: 2, note: "  plays   golf " }) as { influences: import("../app/lib/org-chart-influence").OrgInfluence[]; id: string };
  assert.equal(added.influences.length, 1);
  assert.deepEqual([added.influences[0].from, added.influences[0].to, added.influences[0].strength, added.influences[0].note], ["a", "b", 2, "plays golf"]);
  assert.match((applyInfluenceEdit(added.influences, people, { op: "add", from: "a", to: "b" }) as { error: string }).error, /already influences/);
  assert.match((applyInfluenceEdit(added.influences, people, { op: "add", from: "b", to: "a" }) as { error: string }).error, /one direction/);
  assert.ok("error" in applyInfluenceEdit([], people, { op: "add", from: "a", to: "a" }));
  assert.ok("error" in applyInfluenceEdit([], people, { op: "add", from: "a", to: "zz" }));
  const reversed = applyInfluenceEdit(added.influences, people, { op: "reverse", id: added.id }) as { influences: import("../app/lib/org-chart-influence").OrgInfluence[] };
  assert.deepEqual([reversed.influences[0].from, reversed.influences[0].to], ["b", "a"]);
  const changed = applyInfluenceEdit(added.influences, people, { op: "update", id: added.id, strength: 1 }) as { influences: import("../app/lib/org-chart-influence").OrgInfluence[] };
  assert.equal(changed.influences[0].strength, 1);
  assert.deepEqual(keepInfluences(added.influences, ["a", "c"]), []);
  assert.equal(keepInfluences(added.influences, ["a", "b"]).length, 1);
  assert.deepEqual((applyInfluenceEdit(added.influences, people, { op: "remove", id: added.id }) as { influences: unknown[] }).influences, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { commit, syncPlan, type SfCheckpointRow, type SfPhaseRow, type SyncPlan } from "../app/lib/close-plan-sfdc-sync";

const phases: SfPhaseRow[] = [{ Id: "a0P000000000001AAA", iseeit__Title__c: "Align", iseeit__Start_Date__c: "2026-10-01", iseeit__End_Date__c: "2026-10-30" }];
const row = (o: Partial<SfCheckpointRow> = {}): SfCheckpointRow => ({ Id: "a0Q000000000001AAA", iseeit__Title__c: "Kickoff", iseeit__Current_Phase__c: phases[0].Id, iseeit__Phase_Checkpoint_Status__c: "Open", iseeit__Deadline__c: "2026-10-10", iseeit__Interaction_Type__c: "Mutual", iseeit__Checklist_Description__c: "", ...o });
const plan = (tasks: SyncPlan["tasks"] = [], syncedAt?: string): SyncPlan => ({ people: [{ id: "p1", name: "Sam", sfdcUserId: "005000000000001AAA" }], phases: [{ id: "align", name: "Align", start: "2026-10-01", end: "2026-10-30" }], tasks, planOwners: { seller: "p1" }, sfdc: syncedAt ? { syncedAt } : undefined });
const task = (o: object = {}) => ({ id: "t1", phase: "align", parent: null, title: "Kickoff", desc: "", owner: "p1", due: "2026-10-10", status: "Open", shared: true, ...o }) as SyncPlan["tasks"][number];
const seen = { title: "Kickoff", desc: "", status: "Open", due: "2026-10-10", shared: true, owners: "" };

test("links phases by name and adds checkpoints missing from the plan", () => {
  const o = syncPlan(plan(), phases, [row()]);
  assert.equal(o.plan.phases[0].sfdcId, phases[0].Id);
  assert.equal(o.plan.tasks.length, 1);
  assert.equal(o.plan.tasks[0].sfdcSeen?.title, "Kickoff");
  assert.equal(o.updates.length + o.creates.length, 0);
});

test("a checkpoint changed only in Salesforce is pulled", () => {
  const p = plan([task({ sfdcId: "a0Q000000000001AAA", sfdcSeen: seen })], "t");
  const o = syncPlan(p, phases, [row({ iseeit__Phase_Checkpoint_Status__c: "Done" })]);
  assert.equal(o.plan.tasks[0].status, "Closed");
  assert.equal(o.updates.length, 0);
});

test("a task changed only in the plan is pushed", () => {
  const p = plan([task({ sfdcId: "a0Q000000000001AAA", sfdcSeen: seen, status: "Closed", due: "2026-10-20" })], "t");
  const o = syncPlan(p, phases, [row()]);
  assert.deepEqual(o.updates[0].fields, { iseeit__Phase_Checkpoint_Status__c: "Done", iseeit__Status__c: true, iseeit__Deadline__c: "2026-10-20" });
  const next = commit(o, "006000000000001AAA", { updated: new Set(["t1"]), created: new Map() });
  assert.equal(next.tasks[0].sfdcSeen?.status, "Closed");
});

test("both changed: the plan wins and the overwritten value is noted", () => {
  const p = plan([task({ sfdcId: "a0Q000000000001AAA", sfdcSeen: seen, due: "2026-10-20" })], "t");
  const o = syncPlan(p, phases, [row({ iseeit__Deadline__c: "2026-10-15" })]);
  assert.equal(o.plan.tasks[0].due, "2026-10-20");
  assert.equal(o.updates[0].fields.iseeit__Deadline__c, "2026-10-20");
  assert.equal(o.conflicts.length, 1);
  assert.match(o.plan.activity![0].text, /Salesforce had “2026-10-15”/);
});

test("different fields changed on each side are both kept", () => {
  const p = plan([task({ sfdcId: "a0Q000000000001AAA", sfdcSeen: seen, desc: "mine" })], "t");
  const o = syncPlan(p, phases, [row({ iseeit__Deadline__c: "2026-10-15" })]);
  assert.equal(o.plan.tasks[0].due, "2026-10-15");
  assert.equal(o.updates[0].fields.iseeit__Checklist_Description__c, "mine");
  assert.equal(o.conflicts.length, 0);
});

test("first sync holds back plan-only tasks unless asked; later syncs create new ones", () => {
  const first = syncPlan(plan([task({ title: "Mine" })]), phases, []);
  assert.equal(first.unlinked, 1); assert.equal(first.creates.length, 0);
  const sent = syncPlan(plan([task({ title: "Mine" })]), phases, [], { sendUnlinked: true });
  assert.equal(sent.creates[0].fields.iseeit__Current_Phase__c, phases[0].Id);
  assert.equal(sent.creates[0].fields.iseeit__Is_From_Close_Plan__c, true);
  const done = commit(first, "006000000000001AAA", { updated: new Set(), created: new Map() });
  assert.equal(done.tasks[0].sfdcSkip, true);
  const later = syncPlan(plan([task({ title: "New" })], "t"), phases, []);
  assert.equal(later.creates.length, 1);
});

test("a task that already exists in Salesforce by title is adopted, not duplicated", () => {
  const o = syncPlan(plan([task({ desc: "mine" })]), phases, [row()]);
  assert.equal(o.plan.tasks.length, 1);
  assert.equal(o.plan.tasks[0].sfdcId, "a0Q000000000001AAA");
  assert.equal(o.updates[0].fields.iseeit__Checklist_Description__c, "mine");
});

test("owners are pushed only when everyone has a Salesforce id", () => {
  const p = plan([task({ sfdcId: "a0Q000000000001AAA", sfdcSeen: { ...seen, planOwners: "005000000000001AAA" }, coworkers: ["p2"] })], "t");
  p.people.push({ id: "p2", name: "No Id" });
  assert.equal(syncPlan(p, phases, [row()]).updates.length, 0);
  p.people[1].sfdcContactId = "003000000000001AAA";
  const o = syncPlan(p, phases, [row()]);
  assert.equal(o.updates[0].fields.iseeit__Phase_Checkpoint_Owner__c, "005000000000001AAA,003000000000001AAA");
});

test("a checkpoint deleted in Salesforce unlinks its task but keeps it", () => {
  const o = syncPlan(plan([task({ sfdcId: "a0Q000000000009AAA", sfdcSeen: seen })], "t"), phases, []);
  assert.equal(o.plan.tasks.length, 1);
  assert.equal(o.plan.tasks[0].sfdcId, undefined);
});

import { applySalesforceIds, idLookupQueries } from "../app/lib/close-plan-sfdc-sync";

test("people get Salesforce ids by email, and apostrophes can't break the query", () => {
  const p = plan();
  p.people = [{ id: "a", name: "A", email: "a@iseeit.com", side: "seller" }, { id: "b", name: "B", email: "b@cust.com", side: "buyer" }, { id: "c", name: "C", email: "o'brien@cust.com", side: "buyer" }, { id: "d", name: "D", email: "x@y.com", side: "seller", sfdcUserId: "005000000000009AAA" }];
  const q = idLookupQueries(p.people);
  assert.equal(q.users, "SELECT Id, Email FROM User WHERE IsActive = true AND Email IN ('a@iseeit.com')");
  assert.match(q.contacts!, /Email IN \('b@cust\.com'\)/);
  assert.doesNotMatch(q.contacts!, /o'brien/);
  applySalesforceIds(p, [{ Id: "005000000000001AAA", Email: "A@iseeit.com" }], [{ Id: "003000000000001AAA", Email: "b@cust.com" }]);
  assert.equal(p.people[0].sfdcUserId, "005000000000001AAA");
  assert.equal(p.people[1].sfdcContactId, "003000000000001AAA");
  assert.equal(p.people[3].sfdcUserId, "005000000000009AAA");
});

test("a new task is created with its owners once they have Salesforce ids", () => {
  const o = syncPlan(plan([task({ title: "Mine" })], "t"), phases, []);
  assert.equal(o.creates[0].fields.iseeit__Phase_Checkpoint_Owner__c, "005000000000001AAA");
  assert.equal(o.creates[0].fields.iseeit__Checkpoint_Phase_Owner_Description__c, "Sam");
});

test("an owner change on a linked task is pushed once the baseline is known", () => {
  const p = plan([task({ sfdcId: "a0Q000000000001AAA", sfdcSeen: { ...seen, planOwners: "003000000000001AAA", owners: "003000000000001AAA" } })], "t");
  p.people.push({ id: "p2", name: "Other", sfdcContactId: "003000000000001AAA" });
  const o = syncPlan(p, phases, [row({ iseeit__Phase_Checkpoint_Owner__c: "003000000000001AAA" })]);
  assert.equal(o.updates[0].fields.iseeit__Phase_Checkpoint_Owner__c, "005000000000001AAA");
});

test("phase name and dates sync both ways; the plan wins when both changed", () => {
  const sfPhase = (o: Partial<SfPhaseRow> = {}): SfPhaseRow[] => [{ ...phases[0], ...o }];
  const base = { title: "Align", start: "2026-10-01", end: "2026-10-30" };
  const mk = (o: object) => { const p = plan(); p.phases = [{ id: "align", name: "Align", start: "2026-10-01", end: "2026-10-30", sfdcId: phases[0].Id, sfdcSeen: base, ...o }]; return p; };
  // Salesforce moved the end date: pulled.
  const pulled = syncPlan(mk({}), sfPhase({ iseeit__End_Date__c: "2026-11-15" }), []);
  assert.equal(pulled.plan.phases[0].end, "2026-11-15");
  assert.equal(pulled.phaseUpdates.length, 0);
  // The plan renamed it: pushed.
  const pushed = syncPlan(mk({ name: "Discover" }), sfPhase(), []);
  assert.deepEqual(pushed.phaseUpdates[0].fields, { iseeit__Title__c: "Discover" });
  // Both changed the end date: the plan wins.
  const both = syncPlan(mk({ end: "2026-11-01" }), sfPhase({ iseeit__End_Date__c: "2026-11-15" }), []);
  assert.equal(both.plan.phases[0].end, "2026-11-01");
  assert.deepEqual(both.phaseUpdates[0].fields, { iseeit__End_Date__c: "2026-11-01" });
  assert.equal(both.conflicts.length, 1);
  const next = commit(pushed, "006000000000001AAA", { updated: new Set([pushed.phaseUpdates[0].phaseId]), created: new Map() });
  assert.equal(next.phases[0].sfdcSeen?.title, "Discover");
});

import { addOwnerPeople, ownerLookupQueries, unknownOwnerIds } from "../app/lib/close-plan-sfdc-sync";

test("owners that exist only in Salesforce are added to the plan and then pulled as owner and coworker", () => {
  const rows = [row({ iseeit__Phase_Checkpoint_Owner__c: "003000000000001AAA,005000000000001AAA" })];
  const p = plan([task({ sfdcId: "a0Q000000000001AAA", sfdcSeen: { ...seen, owners: "", planOwners: "005000000000001AAA" } })], "t");
  const ids = unknownOwnerIds(p, rows);
  assert.deepEqual(ids, { users: [], contacts: ["003000000000001AAA"] });
  assert.match(ownerLookupQueries(ids).contacts!, /FROM Contact WHERE Id IN \('003000000000001AAA'\)/);
  assert.equal(addOwnerPeople(p, [], [{ Id: "003000000000001AAA", Name: "Bryan Wolski", Email: "bryan@cust.com", Title: "VP" }]), 1);
  assert.equal(p.people.at(-1)!.side, "buyer");
  const o = syncPlan(p, phases, rows);
  assert.equal(o.plan.tasks[0].owner, o.plan.people.find(x => x.name === "Bryan Wolski")!.id);
  assert.deepEqual(o.plan.tasks[0].coworkers, ["p1"]);
});

test("a Salesforce person with a known email gets the id instead of a duplicate", () => {
  const p = plan(); p.people.push({ id: "x", name: "Drew", email: "drew@iseeit.com", side: "seller" });
  assert.equal(addOwnerPeople(p, [{ Id: "005000000000007AAA", Name: "Drew Klein", Email: "Drew@iseeit.com" }], []), 0);
  assert.equal(p.people.find(x => x.id === "x")!.sfdcUserId, "005000000000007AAA");
});

test("task order: Salesforce reorders → pulled with subtasks following; plan reorders → pushed; both → plan wins", () => {
  const ids = ["a0Q000000000001AAA", "a0Q000000000002AAA", "a0Q000000000003AAA"];
  const sfRows = (orders: string[]) => ids.map((Id, i) => row({ Id, iseeit__Title__c: "T" + i, iseeit__Close_Plan_Order__c: orders[i] }));
  const mk = () => plan([0, 1, 2].flatMap(i => [task({ id: "t" + i, title: "T" + i, sfdcId: ids[i], sfdcSeen: { ...seen, title: "T" + i }, sfdcRank: i }), ...(i === 0 ? [task({ id: "s0", parent: "t0", title: "Sub" })] : [])]), "t");
  // Salesforce: T2 first.
  const pulled = syncPlan(mk(), phases, sfRows(["1", "2", "0"]));
  assert.deepEqual(pulled.plan.tasks.filter(t => !t.parent).map(t => t.id), ["t2", "t0", "t1"]);
  assert.deepEqual(pulled.plan.tasks.map(t => t.id), ["t2", "t0", "s0", "t1"]);
  assert.equal(pulled.updates.length, 0);
  // The plan moved T2 first; Salesforce unchanged.
  const p = mk(); const [t0, t1, t2] = [p.tasks[0], p.tasks[2], p.tasks[3]]; p.tasks = [t2, t0, p.tasks[1], t1];
  const pushed = syncPlan(p, phases, sfRows(["0", "1", "2"]));
  assert.deepEqual(pushed.updates.map(u => [u.taskId, u.fields.iseeit__Close_Plan_Order__c]).sort(), [["t0", "1"], ["t1", "2"], ["t2", "0"]]);
  // Both moved differently: the plan wins.
  const both = syncPlan(p, phases, sfRows(["2", "1", "0"]));
  assert.equal(both.conflicts.length, 1);
  assert.deepEqual(both.plan.tasks.filter(t => !t.parent).map(t => t.id), ["t2", "t0", "t1"]);
});

test("phase order syncs the same way, and a Sales AI contact id becomes the Salesforce contact id", () => {
  const two: SfPhaseRow[] = [{ Id: "a0P000000000001AAA", iseeit__Title__c: "Align", iseeit__Phase_Order__c: "2" }, { Id: "a0P000000000002AAA", iseeit__Title__c: "Build", iseeit__Phase_Order__c: "1" }];
  const p = plan(); p.phases = [{ id: "a", name: "Align", sfdcId: two[0].Id, sfdcSeen: { title: "Align", start: null, end: null }, sfdcRank: 0 }, { id: "b", name: "Build", sfdcId: two[1].Id, sfdcSeen: { title: "Build", start: null, end: null }, sfdcRank: 1 }];
  const pulled = syncPlan(p, two, []);
  assert.deepEqual(pulled.plan.phases.map(x => x.id), ["b", "a"]);
  p.people.push({ id: "c", name: "Bryan", side: "buyer", email: "", contactIds: ["f4a0b2d6-uuid", "003000000000004AAA"] });
  idLookupQueries(p.people);
  assert.equal(p.people.at(-1)!.sfdcContactId, "003000000000004AAA");
});

test("a phase added in the plan is created in Salesforce with its tasks, and the others are renumbered", () => {
  const sfp: SfPhaseRow[] = [{ Id: "a0P000000000001AAA", iseeit__Title__c: "Align", iseeit__Phase_Order__c: "1", iseeit__Start_Date__c: "2026-10-01", iseeit__End_Date__c: "2026-10-30" }, { Id: "a0P000000000002AAA", iseeit__Title__c: "Close", iseeit__Phase_Order__c: "2" }];
  const mk = (syncedAt?: string) => { const p = plan([task({ id: "n1", phase: "mid", title: "In new phase" })], syncedAt);
    p.phases = [{ id: "align", name: "Align", sfdcId: sfp[0].Id, sfdcRank: 0, sfdcSeen: { title: "Align", start: "2026-10-01", end: "2026-10-30" } }, { id: "mid", name: "Middle", start: "2026-11-01", end: "2026-11-15" }, { id: "close", name: "Close", sfdcId: sfp[1].Id, sfdcRank: 1, sfdcSeen: { title: "Close", start: null, end: null } }]; return p; };
  const o = syncPlan(mk("t"), sfp, []);
  assert.equal(o.phaseCreates.length, 1);
  assert.deepEqual(o.phaseCreates[0].fields, { iseeit__Title__c: "Middle", iseeit__Start_Date__c: "2026-11-01", iseeit__End_Date__c: "2026-11-15", iseeit__Phase_Order__c: "2" });
  assert.equal(o.creates[0].phaseRef, "mid");
  assert.equal(o.phaseUpdates.find(u => u.phaseId === "close")!.fields.iseeit__Phase_Order__c, "3");
  const done = commit(o, "006000000000001AAA", { updated: new Set(["close"]), created: new Map([["n1", "a0Q000000000009AAA"]]), createdPhases: new Map([["mid", "a0P000000000003AAA"]]) });
  assert.equal(done.phases[1].sfdcId, "a0P000000000003AAA");
  // First sync: held back unless asked.
  const first = syncPlan(mk(), sfp, []);
  assert.equal(first.phaseCreates.length, 0);
  assert.ok(first.unlinked >= 1);
});

test("a task deleted in Close Plan deletes its checkpoint in Salesforce and is not pulled back meanwhile", () => {
  const p = plan([], "t"); p.sfdcDeleted = [{ id: "a0Q000000000001AAA", title: "Gone" }, { id: "a0Q000000000008AAA", title: "Already gone" }];
  const o = syncPlan(p, phases, [row()]);
  assert.deepEqual(o.deletes, [{ id: "a0Q000000000001AAA", title: "Gone" }]);
  assert.equal(o.plan.tasks.length, 0);
  const done = commit(o, "006000000000001AAA", { updated: new Set(), created: new Map(), deleted: new Set(["a0Q000000000001AAA"]) });
  assert.equal(done.sfdcDeleted, undefined);
  // A failed delete stays pending for the next sync.
  const retry = commit(syncPlan(p, phases, [row()]), "006000000000001AAA", { updated: new Set(), created: new Map(), deleted: new Set() });
  assert.deepEqual(retry.sfdcDeleted, [{ id: "a0Q000000000001AAA", title: "Gone" }]);
});

test("a checkpoint deleted in Salesforce is removed here; one that only left the close plan is just unlinked", () => {
  const mk = () => plan([task({ id: "t1", sfdcId: "a0Q000000000009AAA", sfdcSeen: seen }), task({ id: "s1", parent: "t1", title: "Sub" })], "t");
  const deleted = syncPlan(mk(), phases, [], { stillInSalesforce: new Set() });
  assert.equal(deleted.plan.tasks.length, 0);
  const moved = syncPlan(mk(), phases, [], { stillInSalesforce: new Set(["a0Q000000000009AAA"]) });
  assert.equal(moved.plan.tasks.length, 2);
  assert.equal(moved.plan.tasks[0].sfdcId, undefined);
});

test("a task moved to another phase is moved in Salesforce, and the other way round; the plan wins when both moved it", () => {
  const sfp: SfPhaseRow[] = [{ Id: "a0P000000000001AAA", iseeit__Title__c: "Align" }, { Id: "a0P000000000002AAA", iseeit__Title__c: "Build" }];
  const [A, B] = [sfp[0].Id, sfp[1].Id];
  const mk = (phase: string) => { const p = plan([task({ id: "t1", phase, sfdcId: "a0Q000000000001AAA", sfdcSeen: { ...seen, phase: A } }), task({ id: "s1", parent: "t1", phase, title: "Sub" })], "t");
    p.phases = [{ id: "align", name: "Align", sfdcId: A }, { id: "build", name: "Build", sfdcId: B }]; return p; };
  const checkpoint = (phaseId: string) => row({ iseeit__Current_Phase__c: phaseId });
  // The plan moved it to Build: pushed.
  const pushed = syncPlan(mk("build"), sfp, [checkpoint(A)]);
  assert.equal(pushed.updates[0].fields.iseeit__Current_Phase__c, B);
  // Salesforce moved it to Build: the task and its subtask follow.
  const pulled = syncPlan(mk("align"), sfp, [checkpoint(B)]);
  assert.deepEqual(pulled.plan.tasks.map(t => t.phase), ["build", "build"]);
  assert.equal(pulled.updates.length, 0);
  // Both moved it, to different phases (a third one): the plan wins.
  const sfp3 = [...sfp, { Id: "a0P000000000003AAA", iseeit__Title__c: "Close" }];
  const p3 = mk("build"); p3.phases.push({ id: "close", name: "Close", sfdcId: sfp3[2].Id });
  const both = syncPlan(p3, sfp3, [checkpoint(sfp3[2].Id)]);
  assert.equal(both.plan.tasks[0].phase, "build");
  assert.equal(both.updates[0].fields.iseeit__Current_Phase__c, B);
  assert.equal(both.conflicts.length, 1);
});

test("a task moved into a phase that is being created follows it there in the same sync", () => {
  const sfp: SfPhaseRow[] = [{ Id: "a0P000000000001AAA", iseeit__Title__c: "Align" }];
  const p = plan([task({ id: "t1", phase: "fresh", sfdcId: "a0Q000000000001AAA", sfdcSeen: { ...seen, phase: sfp[0].Id } })], "t");
  p.phases = [{ id: "align", name: "Align", sfdcId: sfp[0].Id }, { id: "fresh", name: "Fresh" }];
  const o = syncPlan(p, sfp, [row({ iseeit__Current_Phase__c: sfp[0].Id })]);
  assert.equal(o.phaseCreates.length, 1);
  assert.equal(o.updates[0].phaseRef, "fresh");
});

test("a checkpoint created in Salesforce is credited to its creator, not to the person it is owned by", () => {
  const p = plan(); p.people.push({ id: "c1", name: "Erik", sfdcContactId: "003000000000001AAA", side: "buyer" } as SyncPlan["people"][number]);
  const o = syncPlan(p, phases, [row({ iseeit__Phase_Checkpoint_Owner__c: "003000000000001AAA", CreatedById: "005000000000001AAA" })]);
  assert.equal(o.plan.tasks[0].owner, "c1"); assert.equal(o.plan.tasks[0].createdBy, "p1");
  const unknown = syncPlan(plan(), phases, [row({ CreatedById: "005000000000009AAA" })]);
  assert.equal(unknown.plan.tasks[0].createdBy, "p1"); // creator not on the plan: the plan's seller side, never the owner
});

test("a checkpoint without a deadline becomes a task without a due date, and no date is pushed back", () => {
  const o = syncPlan(plan(), phases, [row({ iseeit__Deadline__c: null })]);
  assert.equal(o.plan.tasks[0].due, undefined);
  assert.equal(o.updates.length, 0);
  const again = syncPlan(o.plan, phases, [row({ iseeit__Deadline__c: null })]);
  assert.equal(again.updates.length, 0); assert.equal(again.plan.tasks[0].due, undefined);
});

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

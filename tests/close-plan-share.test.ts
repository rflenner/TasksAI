import assert from "node:assert/strict";
import test from "node:test";
import { applyCustomerChanges, customerView, markOpened } from "../app/lib/close-plan-share";

// Fictional data only — this repository is public.
const plan = () => ({
  id: "pl1", title: "Rollout", account: "Meridian Biotech", status: "active",
  opp: { name: "Rollout", stage: "Discovery", amount: 50000 },
  setup: { dates: true },
  planOwners: { seller: "s1", buyer: "b1" },
  phases: [{ id: "p1", name: "Align", start: "2026-10-05", end: "2026-10-09" }],
  people: [
    { id: "s1", side: "seller", name: "Sam Seller", email: "sam@iseeit.example", access: { level: "all", create: true }, invite: { status: "member" } },
    { id: "b1", side: "buyer", name: "Olivia Grant", email: "olivia@meridian-bio.example", access: { level: "own", create: true }, invite: { status: "invited", at: "2026-10-01" } },
    { id: "b2", side: "buyer", name: "Marcus Reid", email: "marcus@meridian-bio.example", access: { level: "view", create: false } },
  ],
  tasks: [
    { id: "t1", phase: "p1", parent: null, title: "Kickoff", owner: "b1", status: "Open", shared: true, updates: [], coworkers: [], recipients: [] },
    { id: "t2", phase: "p1", parent: null, title: "Internal pricing", owner: "s1", status: "Open", shared: false, updates: [] },
    { id: "t3", phase: "p1", parent: "t2", title: "Discount approval", owner: "s1", status: "Open", shared: true, updates: [] },
    { id: "t4", phase: "p1", parent: null, title: "Security review", owner: "s1", status: "Open", shared: true, updates: [], coworkers: [], recipients: ["b1"] },
    { id: "t5", phase: "p1", parent: "t1", title: "Agenda", owner: "s1", status: "Open", shared: true, updates: [] },
  ],
  activity: [{ at: "2026-10-01", by: "s1", text: "closed “Internal pricing”", task: "t2" }, { at: "2026-10-01", by: "s1", text: "added Olivia Grant to the plan", task: null }],
});

test("customerView leaves out internal tasks, their subtasks and activity, deal data and iSEEit emails", () => {
  const v = customerView(plan(), "b1")!;
  assert.deepEqual((v.tasks as { id: string }[]).map(t => t.id), ["t1", "t4", "t5"]);
  assert.equal((v.activity as unknown[]).length, 1);
  assert.equal(v.opp, undefined);
  assert.equal(v.setup, undefined);
  const people = v.people as { id: string; email?: string }[];
  assert.equal(people.find(p => p.id === "s1")!.email, undefined);
  assert.equal(people.find(p => p.id === "b1")!.email, "olivia@meridian-bio.example");
});

test("customerView is only for customer contacts still on the plan", () => {
  assert.equal(customerView(plan(), "s1"), null);
  assert.equal(customerView(plan(), "nobody"), null);
});

test("a contact can update their own task and post updates; the main task starts with a subtask", () => {
  const { data, ignored } = applyCustomerChanges(plan(), "b1", {
    tasks: [{ id: "t1", status: "Closed", title: "Kickoff call", updates: [{ by: "b1", at: "2026-10-02", text: "Done" }] }],
    activity: [{ text: "closed “Kickoff”", task: "t1" }],
  }, "2026-10-02");
  const t1 = (data.tasks as Record<string, unknown>[]).find(t => t.id === "t1")!;
  assert.equal(t1.status, "Closed");
  assert.equal(t1.closedAt, "2026-10-02");
  assert.equal(t1.title, "Kickoff call");
  assert.equal((t1.updates as unknown[]).length, 1);
  assert.equal(ignored, 0);
  assert.equal((data.activity as { by: string }[])[0].by, "b1");
});

test("as requester a contact may post updates and set the status, but not edit the task", () => {
  const { data, ignored } = applyCustomerChanges(plan(), "b1", {
    tasks: [{ id: "t4", status: "In progress", title: "Renamed", owner: "b1", updates: [{ by: "b1", at: "2026-10-02", text: "Sent the questionnaire" }] }],
  }, "2026-10-02");
  const t4 = (data.tasks as Record<string, unknown>[]).find(t => t.id === "t4")!;
  assert.equal(t4.status, "In progress");
  assert.equal(t4.title, "Security review");
  assert.equal(t4.owner, "s1");
  assert.equal(ignored, 2);
});

test("internal tasks, other people's tasks and the shared flag can't be changed", () => {
  const { data, ignored } = applyCustomerChanges(plan(), "b1", {
    tasks: [{ id: "t2", status: "Closed" }, { id: "t3", status: "Closed" }, { id: "t5", status: "Closed" }, { id: "t1", shared: false }],
  }, "2026-10-02");
  const byId = Object.fromEntries((data.tasks as Record<string, unknown>[]).map(t => [t.id, t]));
  assert.equal(byId.t2.status, "Open");
  assert.equal(byId.t3.status, "Open");
  assert.equal(byId.t5.status, "Open");
  assert.equal(byId.t1.shared, true);
  assert.equal(ignored, 3);
});

test("updates in someone else's name and edits to earlier updates are dropped", () => {
  const p = plan(); (p.tasks[0].updates as unknown[]).push({ by: "s1", at: "2026-10-01", text: "Original" });
  const { data } = applyCustomerChanges(p, "b1", {
    tasks: [{ id: "t1", updates: [{ by: "s1", at: "2026-10-01", text: "Tampered" }, { by: "s1", at: "2026-10-02", text: "Fake" }, { by: "b1", at: "2026-10-02", text: "Mine" }] }],
  }, "2026-10-02");
  const ups = (data.tasks as Record<string, unknown>[]).find(t => t.id === "t1")!.updates as { text: string }[];
  assert.deepEqual(ups.map(u => u.text), ["Original", "Mine"]);
});

test("new tasks and subtasks: shared, created by the contact, only under shared tasks and in existing phases", () => {
  const { data, ignored } = applyCustomerChanges(plan(), "b1", {
    tasks: [
      { id: "cx1", phase: "p1", parent: null, title: "Book a room", shared: false },
      { id: "cx2", phase: "p1", parent: "t1", title: "Send invites", status: "In progress" },
      { id: "cx3", phase: "p1", parent: "t2", title: "Peek at pricing" },
      { id: "cx4", phase: "nope", parent: null, title: "Nowhere" },
    ],
  }, "2026-10-02");
  const byId = Object.fromEntries((data.tasks as Record<string, unknown>[]).map(t => [t.id, t]));
  assert.equal(byId.cx1.shared, true);
  assert.equal(byId.cx1.createdBy, "b1");
  assert.equal(byId.cx1.owner, "b1");
  assert.equal(byId.cx2.parent, "t1");
  assert.equal(byId.t1.status, "In progress");
  assert.equal(byId.cx3, undefined);
  assert.equal(byId.cx4, undefined);
  assert.equal(ignored, 2);
});

test("view-only contacts can't change or add anything", () => {
  const { data, applied } = applyCustomerChanges(plan(), "b2", {
    tasks: [{ id: "t1", status: "Closed" }, { id: "cx1", phase: "p1", title: "New" }],
  }, "2026-10-02");
  assert.equal(applied, 0);
  assert.equal((data.tasks as unknown[]).length, 5);
});

test("people, phases and plan owners are never changed by a customer save", () => {
  const { data } = applyCustomerChanges(plan(), "b1", { tasks: [], activity: [] }, "2026-10-02");
  assert.deepEqual(data.people, plan().people);
  assert.deepEqual(data.phases, plan().phases);
  assert.deepEqual(data.planOwners, plan().planOwners);
});

test("applyCustomerChanges refuses someone who isn't a customer contact", () => {
  assert.throws(() => applyCustomerChanges(plan(), "s1", { tasks: [] }, "2026-10-02"));
});

test("markOpened sets the invitation to opened once", () => {
  const opened = markOpened(plan(), "b1", "2026-10-02")!;
  const b1 = (opened.people as Record<string, unknown>[]).find(p => p.id === "b1")!;
  assert.equal((b1.invite as { status: string }).status, "active");
  assert.equal(markOpened(opened, "b1", "2026-10-03"), null);
});

test("a contact can delete only tasks they added themselves", () => {
  const p = plan();
  p.tasks.push({ id: "cx1", phase: "p1", parent: null, title: "Mine", owner: "b1", status: "Open", shared: true, createdBy: "b1", updates: [] } as never);
  p.tasks.push({ id: "cx2", phase: "p1", parent: "cx1", title: "Mine too", owner: "b1", status: "Open", shared: true, createdBy: "b1", updates: [] } as never);
  const { data, applied, ignored } = applyCustomerChanges(p, "b1", { deleted: ["cx1", "t1", "t2"] }, "2026-10-06");
  const ids = (data.tasks as { id: string }[]).map(t => t.id);
  assert.equal(ids.includes("cx1"), false);
  assert.equal(ids.includes("cx2"), false);
  assert.equal(ids.includes("t1"), true);
  assert.equal(ids.includes("t2"), true);
  assert.equal(applied, 1);
  assert.equal(ignored, 2);
});

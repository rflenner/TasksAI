import assert from "node:assert/strict";
import test from "node:test";
import { describeChanges } from "../app/lib/close-plan-access-log";

const base = () => ({
  title: "Acme", phases: [{ id: "p1", name: "Validation", start: "2026-10-01", end: "2026-11-01" }], planOwners: { seller: "s1", buyer: null },
  people: [{ id: "s1", name: "Drew", side: "seller", email: "d@x.com", role: "Account lead" }, { id: "c1", name: "Erik", side: "buyer", email: "e@y.com", role: "Legal" }],
  tasks: [{ id: "t1", title: "Security review", status: "Open", due: "2026-10-30", owner: "c1", coworkers: [], recipients: [], updates: [], shared: true, phase: "p1" },
          { id: "t2", title: "Pricing", status: "Open", due: null, owner: "s1", coworkers: [], recipients: [], updates: [], shared: false, phase: "p1" }],
  activity: [],
});
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

test("nothing that matters changed gives null (activity text and sync bookkeeping are ignored)", () => {
  const a = base(), b = clone(a) as ReturnType<typeof base> & Record<string, unknown>;
  b.activity = [{ text: "x" }] as never; (b.tasks[0] as Record<string, unknown>).sfdcSeen = { status: "Open" };
  assert.equal(describeChanges(a, b), null);
});
test("one task changed names the task and the changes", () => {
  const a = base(), b = clone(a); b.tasks[0].status = "Closed"; b.tasks[0].due = "2026-11-05";
  const r = describeChanges(a, b)!;
  assert.equal(r.taskId, "t1"); assert.equal(r.taskTitle, "Security review");
  assert.match(r.detail, /“Security review”: status Open → Closed, due 2026-11-05/);
});
test("an update posted, a new owner, and added and deleted tasks are described", () => {
  const a = base(), b = clone(a);
  (b.tasks[0].updates as unknown[]).push({ text: "ok" }); b.tasks[1].owner = "c1";
  b.tasks.push({ id: "t3", title: "Legal", status: "Open", due: null, owner: "s1", coworkers: [], recipients: [], updates: [], shared: true, phase: "p1" });
  const r = describeChanges(a, b)!;
  assert.equal(r.taskId, null);
  assert.match(r.detail, /“Security review”: posted an update/); assert.match(r.detail, /“Pricing”: owner → Erik/); assert.match(r.detail, /added “Legal”/);
  const gone = clone(a); gone.tasks.pop();
  assert.match(describeChanges(a, gone)!.detail, /deleted “Pricing”/);
});
test("plan-level changes (people, phases, owners) are summarised, long lists are cut", () => {
  const a = base(), b = clone(a); b.people[1].role = "Procurement"; b.phases[0].name = "Evaluation";
  assert.match(describeChanges(a, b)!.detail, /plan phases, people/);
  const many = clone(a); many.tasks = Array.from({ length: 12 }, (_, i) => ({ ...a.tasks[0], id: `n${i}`, title: `T${i}`, status: "Closed" }));
  const r = describeChanges({ ...a, tasks: many.tasks.map(t => ({ ...t, status: "Open" })) }, many)!;
  assert.match(r.detail, /and 6 more$/); assert.ok(r.detail.length <= 900);
});

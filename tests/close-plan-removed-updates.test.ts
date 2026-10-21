import assert from "node:assert/strict";
import test from "node:test";
import { changeEntries } from "../app/lib/close-plan-access-log";
import { applyCustomerChanges, customerView } from "../app/lib/close-plan-share";

const plan = () => ({
  people: [{ id: "s1", side: "seller", name: "Drew" }, { id: "c1", side: "buyer", name: "Erik", access: { level: "own", create: true } }],
  phases: [{ id: "p1", name: "Eval" }],
  tasks: [{ id: "t1", phase: "p1", title: "Demo", status: "Open", owner: "c1", shared: true, coworkers: [], recipients: [], updates: [
    { by: "s1", at: "2026-10-18", text: "Booked" }, { by: "c1", at: "2026-10-19", text: "test", removed: true }, { by: "s1", at: "2026-10-20", text: "Confirmed" }] }],
  activity: [],
});
const texts = (t: Record<string, unknown>) => (t.updates as Array<{ text: string; removed?: boolean }>).filter(u => !u.removed).map(u => u.text);

test("customers never see a removed update", () => {
  const view = customerView(plan(), "c1")!, tasks = view.tasks as Array<Record<string, unknown>>;
  assert.deepEqual(texts(tasks[0]), ["Booked", "Confirmed"]);
  assert.equal((tasks[0].updates as unknown[]).length, 2);
});
test("a customer's new update still saves when a removed one sits in the stored list", () => {
  const stored = plan(), view = customerView(stored, "c1")!;
  const mine = JSON.parse(JSON.stringify((view.tasks as Array<Record<string, unknown>>)[0]));
  mine.updates.push({ by: "c1", at: "2026-10-21", text: "New question" });
  const r = applyCustomerChanges(stored, "c1", { tasks: [mine] }, "2026-10-21");
  assert.equal(r.applied, 1);
  assert.deepEqual(texts((r.data.tasks as Array<Record<string, unknown>>)[0]), ["Booked", "Confirmed", "New question"]);
  assert.equal(((r.data.tasks as Array<Record<string, unknown>>)[0].updates as unknown[]).length, 4);
});
test("removing a status update shows up as a change on that task", () => {
  const a = plan(), b = JSON.parse(JSON.stringify(a)); b.tasks[0].updates[2].removed = true;
  const e = changeEntries(a, b);
  assert.equal(e.length, 1); assert.equal(e[0].taskId, "t1"); assert.equal(e[0].detail, "removed a status update");
});

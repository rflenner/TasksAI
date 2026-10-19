import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

type Out = { roles: Array<{ id: string; role: string; kept: boolean }>; tasks: Array<{ id: string; owner: string; title: string; due: string; status: string; shared: boolean; milestone: boolean; phase: string; updates: unknown[]; recipients: string[] }> };
const { planDemoContent } = createRequire(import.meta.url)("../public/close-plan-demo-content.js") as { planDemoContent: (i: unknown) => Out };

const people = [{ id: "rf", side: "seller", name: "Rizan", title: "Account lead" }, { id: "se", side: "seller", name: "Sam", title: "" }, { id: "a", side: "buyer", name: "Anna", title: "VP of Operations" }, { id: "b", side: "buyer", name: "Ben", title: "Security Officer" }, { id: "c", side: "buyer", name: "Cara", title: "Commercial Enablement Lead" }, { id: "d", side: "buyer", name: "Dan", title: "" }];
const phases = [{ id: "p1", name: "Align", start: "2026-10-01", end: "2026-10-20" }, { id: "p2", name: "Validate", start: "2026-10-21", end: "2026-11-10" }, { id: "p3", name: "Finalize", start: "2026-11-11", end: "2026-12-01" }];
const run = (extra: object = {}) => { let n = 100; return planDemoContent({ people, phases, tasks: [], today: "2026-10-25", newId: () => "t" + (++n), sellerOwner: "rf", ...extra }); };

test("roles come from job titles, then the next unused default for the side, never twice", () => {
  const roles = Object.fromEntries(run().roles.map(r => [r.id, r.role]));
  assert.deepEqual(roles, { a: "Executive sponsor", b: "IT security", c: "Project lead", d: "Technical lead", rf: "Account lead", se: "Solutions engineer" });
});

test("existing roles are kept unless replacing is asked for", () => {
  const withRole = people.map(p => p.id === "b" ? { ...p, role: "Champion" } : p);
  const kept = run({ people: withRole }).roles.find(r => r.id === "b")!;
  assert.deepEqual([kept.role, kept.kept], ["Champion", true]);
  const replaced = run({ people: withRole, replace: true }).roles.find(r => r.id === "b")!;
  assert.deepEqual([replaced.role, replaced.kept], ["IT security", false]);
});

test("everyone gets tasks in a phase of the plan, with a mix of statuses and exactly one overdue", () => {
  const { tasks } = run();
  assert.ok(tasks.length >= 10);
  for (const p of people) assert.ok(tasks.some(t => t.owner === p.id), `${p.name} has a task`);
  assert.ok(tasks.every(t => phases.some(ph => ph.id === t.phase && t.due >= ph.start && t.due <= ph.end)), "due dates sit inside their phase");
  const statuses = new Set(tasks.map(t => t.status));
  assert.deepEqual([...statuses].sort(), ["Closed", "In progress", "Open"]);
  assert.equal(tasks.filter(t => t.status === "Open" && t.due < "2026-10-25").length, 1);
  assert.ok(tasks.some(t => t.milestone), "a milestone");
  assert.ok(tasks.some(t => !t.shared), "an internal task");
  assert.ok(tasks.some(t => t.updates.length), "a status update");
  assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length);
});

test("running it twice does not add the same tasks again", () => {
  const first = run();
  const again = run({ tasks: first.tasks.map(t => ({ title: t.title })) });
  assert.equal(again.tasks.length, 0);
});

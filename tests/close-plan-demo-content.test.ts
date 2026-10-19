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

const { madeUpNames, renameInText } = createRequire(import.meta.url)("../public/close-plan-demo-content.js") as {
  madeUpNames: (people: unknown[], o?: { customers?: boolean; sellers?: boolean; domain?: string }) => Array<{ id: string; oldName: string; name: string; email?: string }>;
  renameInText: (text: string, renames: Array<{ oldName: string; name: string }>, people: Array<{ name: string }>) => string;
};

test("customers get made-up names and made-up addresses; iSEEit people only a new name, and only when asked", () => {
  const renames = madeUpNames(people);
  assert.deepEqual(renames.map(r => r.id), ["a", "b", "c", "d"], "only the customer's people by default");
  assert.ok(renames.every(r => r.email && r.email.endsWith("@acme.example") && !r.email.includes(" ")));
  assert.equal(new Set(renames.map(r => r.name)).size, renames.length);
  const both = madeUpNames(people, { customers: true, sellers: true, domain: "demo.test" });
  const sam = both.find(r => r.id === "se")!;
  assert.equal(sam.email, undefined, "iSEEit addresses stay, they decide who can open the plan");
  assert.ok(both.find(r => r.id === "a")!.email!.endsWith("@demo.test"));
});

test("old names are swapped in free text, including a first name that is unique", () => {
  const ppl = [{ name: "Erik Thorne" }, { name: "Gary Leach" }, { name: "Gary Other" }];
  const renames = [{ oldName: "Erik Thorne", name: "Hannah Weber" }, { oldName: "Gary Leach", name: "Lukas Brenner" }];
  assert.equal(renameInText("Invite Erik to a mutual close plan; Erik Thorne agreed", renames, ppl), "Invite Hannah to a mutual close plan; Hannah Weber agreed");
  assert.equal(renameInText("Gary Leach joined, Gary said hi", renames, ppl), "Lukas Brenner joined, Gary said hi", "an ambiguous first name is left alone");
});

test("old open tasks that are overdue move into the coming weeks, except one that stays overdue; closed ones and future ones are left alone", () => {
  const old = [
    { id: "o1", title: "Old 1", due: "2026-09-20", status: "Open" }, { id: "o2", title: "Old 2", due: "2026-10-01", status: "In progress" },
    { id: "o3", title: "Old 3", due: "2026-10-02", status: "Open" }, { id: "done", title: "Done", due: "2026-09-01", status: "Closed" }, { id: "soon", title: "Soon", due: "2026-10-30", status: "Open" },
  ];
  const out = run({ tasks: old }) as Out & { reschedule: Array<{ id: string; from: string; to: string }> };
  const overdueNew = out.tasks.filter(t => t.status === "Open" && t.due < "2026-10-25").length;
  assert.equal(overdueNew, 1, "the generated overdue task is the one that stays overdue");
  assert.deepEqual(out.reschedule.map(r => r.id), ["o1", "o2", "o3"]);
  assert.deepEqual(out.reschedule.map(r => r.to), ["2026-10-27", "2026-10-29", "2026-10-31"]);
  const noGenerated = (planDemoContent({ people: [people[2]], phases: [{ id: "p", name: "Only", start: "2026-12-01", end: "2026-12-20" }], tasks: old, today: "2026-10-25", newId: () => "x" }) as Out & { reschedule: Array<{ id: string }> });
  assert.deepEqual(noGenerated.reschedule.map(r => r.id), ["o2", "o3"], "with no generated overdue task the oldest existing one stays");
  assert.deepEqual((run({ tasks: old, tidy: false }) as Out & { reschedule: unknown[] }).reschedule, []);
});

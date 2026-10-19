import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

type Plan = Record<string, unknown> & { title?: string; tasks: Array<{ id: string }>; activity: Array<{ text: string }>; sfdc: { syncedAt: string }; };
const { rebasePlan } = createRequire(import.meta.url)("../public/close-plan-rebase.js") as { rebasePlan: (local: unknown, base: unknown, server: unknown) => Plan & { tasks: Array<{ id: string; title: string; status: string; sfdcSeen?: unknown }> } };

const base = { title: "Cluepoints SalesAI transition", status: "draft", phases: [{ id: "a", name: "Evaluation", sfdcId: "P1" }], people: [{ id: "u1", name: "Rizan" }],
  tasks: [{ id: "t1", title: "One", status: "Open", sfdcSeen: { title: "One" } }, { id: "t2", title: "Two", status: "Open" }], activity: [{ at: "2026-10-18", by: "u1", text: "created" }], sfdc: { syncedAt: "T0" } };

test("the person's rename survives a newer server version that only changed sync fields", () => {
  const local = { ...base, title: "Cluepoints Mutual Close Plan" };
  const server = { ...base, sfdc: { syncedAt: "T1" }, tasks: [{ ...base.tasks[0], sfdcSeen: { title: "One", planOwners: "x" } }, base.tasks[1]] };
  const out = rebasePlan(local, base, server);
  assert.equal(out.title, "Cluepoints Mutual Close Plan");
  assert.equal(out.sfdc.syncedAt, "T1", "what only the server changed is kept");
  assert.deepEqual(out.tasks[0].sfdcSeen, { title: "One", planOwners: "x" });
});

test("task edits merge field by field with the server's changes to the same task", () => {
  const local = { ...base, tasks: [{ ...base.tasks[0], title: "One (renamed)" }, base.tasks[1]] };
  const server = { ...base, tasks: [{ ...base.tasks[0], status: "Closed" }, base.tasks[1]] };
  const out = rebasePlan(local, base, server);
  assert.equal(out.tasks[0].title, "One (renamed)");
  assert.equal(out.tasks[0].status, "Closed", "the server's change to another field stays");
});

test("added, deleted and reordered tasks are kept; tasks the server added stay too", () => {
  const added = { id: "t3", title: "Three", status: "Open" }, fromServer = { id: "t9", title: "Pulled from Salesforce", status: "Open" };
  const local = { ...base, tasks: [base.tasks[1], base.tasks[0], added] }; // reordered and added
  const server = { ...base, tasks: [...base.tasks, fromServer] };
  const out = rebasePlan(local, base, server);
  assert.deepEqual(out.tasks.map(t => t.id), ["t2", "t1", "t3", "t9"]);
  const deleted = rebasePlan({ ...base, tasks: [base.tasks[0]] }, base, { ...server });
  assert.deepEqual(deleted.tasks.map(t => t.id), ["t1", "t9"]);
});

test("activity entries made by the person are added in front of the server's", () => {
  const mine = { at: "2026-10-19", by: "u1", text: "renamed the close plan" }, theirs = { at: "2026-10-19", by: "sfdc", text: "closed a task" };
  const out = rebasePlan({ ...base, activity: [mine, ...base.activity] }, base, { ...base, activity: [theirs, ...base.activity] });
  assert.deepEqual(out.activity.map(a => a.text), ["renamed the close plan", "closed a task", "created"]);
});

test("nothing changed by the person means the server's version is returned as is", () => {
  const server = { ...base, title: "Renamed by a colleague", sfdc: { syncedAt: "T2" } };
  assert.deepEqual(rebasePlan(base, base, server), server);
});

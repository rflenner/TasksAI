import assert from "node:assert/strict";
import test from "node:test";
import { namesToNotify } from "../app/lib/task-notify";

function task(overrides: Partial<{ owner: string; collaborators: string[]; recipients: string[] }> = {}) {
  return { owner: "Maya Chen", collaborators: [] as string[], recipients: [] as string[], ...overrides };
}

test("namesToNotify: owner, collaborators, and recipients are all included", () => {
  const names = namesToNotify(task({ owner: "Maya Chen", collaborators: ["Sam Lee"], recipients: ["Rizan Flenner"] }), null);
  assert.deepEqual([...names].sort(), ["Maya Chen", "Rizan Flenner", "Sam Lee"]);
});

test("namesToNotify: the actor who made the change is excluded", () => {
  const names = namesToNotify(task({ owner: "Maya Chen", recipients: ["Rizan Flenner"] }), "Maya Chen");
  assert.deepEqual(names, ["Rizan Flenner"]);
});

test("namesToNotify: someone appearing in more than one role is only listed once", () => {
  const names = namesToNotify(task({ owner: "Maya Chen", collaborators: ["Maya Chen"], recipients: ["Maya Chen"] }), null);
  assert.deepEqual(names, ["Maya Chen"]);
});

test("namesToNotify: an empty owner (never set) contributes nothing", () => {
  const names = namesToNotify(task({ owner: "", recipients: ["Rizan Flenner"] }), null);
  assert.deepEqual(names, ["Rizan Flenner"]);
});

test("namesToNotify: nobody left to notify once the actor is excluded -> empty", () => {
  const names = namesToNotify(task({ owner: "Maya Chen", collaborators: [], recipients: [] }), "Maya Chen");
  assert.deepEqual(names, []);
});

test("namesToNotify: a null actorName (system/unknown actor) excludes nobody", () => {
  const names = namesToNotify(task({ owner: "Maya Chen" }), null);
  assert.deepEqual(names, ["Maya Chen"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { retagPatch, retagScopeList } from "../app/lib/data-hygiene";

const task = (overrides: Partial<{ owner: string; collaborators: string[]; recipients: string[]; project: string; recurringMeeting: string; topic: string }> = {}) =>
  ({ owner: "Pavniet", collaborators: [], recipients: [], project: "Pilot", recurringMeeting: "Weekly sync", topic: "Security", ...overrides });

test("retagPatch: person — owner match returns just the owner field", () => {
  const patch = retagPatch("person", "Pavniet", "Pavneet Saluja", task());
  assert.deepEqual(patch, { owner: "Pavneet Saluja" });
});

test("retagPatch: person — collaborator and recipient match are each returned independently", () => {
  const coworker = retagPatch("person", "Pavniet", "Pavneet Saluja", task({ owner: "Someone Else", collaborators: ["Pavniet"] }));
  assert.deepEqual(coworker, { collaborators: ["Pavneet Saluja"] });
  const recipient = retagPatch("person", "Pavniet", "Pavneet Saluja", task({ owner: "Someone Else", recipients: ["Pavniet"] }));
  assert.deepEqual(recipient, { recipients: ["Pavneet Saluja"] });
});

test("retagPatch: person — someone who is both coworker and recipient on the same task gets both fields updated in one patch", () => {
  const patch = retagPatch("person", "Pavniet", "Pavneet Saluja", task({ owner: "Someone Else", collaborators: ["Pavniet"], recipients: ["Pavniet"] }));
  assert.deepEqual(patch, { collaborators: ["Pavneet Saluja"], recipients: ["Pavneet Saluja"] });
});

test("retagPatch: only the matching name in a list is replaced, everyone else stays untouched", () => {
  const patch = retagPatch("person", "Pavniet", "Pavneet Saluja", task({ owner: "Someone Else", collaborators: ["Ada Lovelace", "Pavniet", "Drew Klein"] }));
  assert.deepEqual(patch, { collaborators: ["Ada Lovelace", "Pavneet Saluja", "Drew Klein"] });
});

test("retagPatch: no match on this task returns null", () => {
  assert.equal(retagPatch("person", "Pavniet", "Pavneet Saluja", task({ owner: "Someone Else" })), null);
});

test("retagPatch: from === to is a no-op, even if the task references it", () => {
  assert.equal(retagPatch("person", "Pavniet", "Pavniet", task()), null);
});

test("retagPatch: empty from never matches (a task with a blank project/topic shouldn't get swept into a retag)", () => {
  assert.equal(retagPatch("project", "", "Pilot", task({ project: "" })), null);
});

test("retagPatch: project/meeting/topic each only touch their own field", () => {
  assert.deepEqual(retagPatch("project", "Pilot", "Customer Pilot", task()), { project: "Customer Pilot" });
  assert.deepEqual(retagPatch("meeting", "Weekly sync", "Weekly delivery call", task()), { recurringMeeting: "Weekly delivery call" });
  assert.deepEqual(retagPatch("topic", "Security", "Security & legal", task()), { topic: "Security & legal" });
  assert.equal(retagPatch("project", "Pilot", "Customer Pilot", task({ project: "Other" })), null);
});

test("retagScopeList: renames a matching entry in a user's access-scope list, deduping if the target is already present", () => {
  assert.deepEqual(retagScopeList("project", "Pilot", "Customer Pilot", ["Pilot", "Launch"]), ["Customer Pilot", "Launch"]);
  assert.deepEqual(retagScopeList("project", "Pilot", "Launch", ["Pilot", "Launch"]), ["Launch"]);
});

test("retagScopeList: never applies to person — who a user is isn't a scope list", () => {
  assert.equal(retagScopeList("person", "Pavniet", "Pavneet Saluja", ["Pavniet"]), null);
});

test("retagScopeList: no match, or from === to, returns null", () => {
  assert.equal(retagScopeList("project", "Pilot", "Customer Pilot", ["Launch"]), null);
  assert.equal(retagScopeList("project", "Pilot", "Pilot", ["Pilot"]), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { collapseToSingleTask, detectsMultiTaskTrigger } from "../app/lib/dictate-intent";

test("detectsMultiTaskTrigger recognizes the documented trigger phrases, case-insensitively, anywhere in the transcript", () => {
  assert.equal(detectsMultiTaskTrigger("Please create multiple tasks from this."), true);
  assert.equal(detectsMultiTaskTrigger("First, review the doc. NEXT TASK: send the invite."), true);
  assert.equal(detectsMultiTaskTrigger("...and here's another task for the team."), true);
  assert.equal(detectsMultiTaskTrigger("Let's cover task two now."), true);
  assert.equal(detectsMultiTaskTrigger("Task 3 is to follow up with the client."), true);
});

test("detectsMultiTaskTrigger returns false for an ordinary dictation with no explicit multi-task signal", () => {
  assert.equal(detectsMultiTaskTrigger("Discuss the roadmap and what to present on the second with Shankar."), false);
  assert.equal(detectsMultiTaskTrigger("Create a task for Rizan for Xenofon, Shankar and Drew."), false);
});

test("collapseToSingleTask keeps the first task's subject and joins every distinct description, dropping nothing the model correctly extracted", () => {
  const collapsed = collapseToSingleTask([
    { subject: "Discuss roadmap with Shankar", description: "Review the roadmap and decide what to present." },
    { subject: "Discuss Jira setup", description: "Clarify how hours are booked against stories." },
  ]);
  assert.equal(collapsed.subject, "Discuss roadmap with Shankar");
  assert.equal(collapsed.description, "Review the roadmap and decide what to present. Clarify how hours are booked against stories.");
});

test("collapseToSingleTask unions collaborators/recipients across every task and de-duplicates", () => {
  const collapsed = collapseToSingleTask([
    { subject: "A", description: "a", recipients: ["Shankar Morwal"] },
    { subject: "B", description: "b", recipients: ["Shankar Morwal", "Ada Lovelace"] },
  ]);
  assert.deepEqual(collapsed.recipients, ["Shankar Morwal", "Ada Lovelace"]);
});

test("collapseToSingleTask takes the first non-empty value for single-value fields like due/owner, falling back to the first task's value when none are set", () => {
  const collapsed = collapseToSingleTask([
    { subject: "A", description: "a", due: null, owner: null },
    { subject: "B", description: "b", due: "2026-09-10", owner: "Rizan Flenner" },
  ]);
  assert.equal(collapsed.due, "2026-09-10");
  assert.equal(collapsed.owner, "Rizan Flenner");
  const allEmpty = collapseToSingleTask([{ subject: "A", description: "a", due: null }, { subject: "B", description: "b", due: null }]);
  assert.equal(allEmpty.due, null);
});

test("collapseToSingleTask on a single-item array is a no-op pass-through of that item's own fields", () => {
  const only = { subject: "Solo", description: "Just one thing", owner: "Rizan Flenner", collaborators: [], recipients: [], due: "2026-09-10", topic: null, project: null, recurringMeeting: null };
  assert.deepEqual(collapseToSingleTask([only]), only);
});

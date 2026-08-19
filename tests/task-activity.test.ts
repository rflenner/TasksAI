import assert from "node:assert/strict";
import test from "node:test";
import { describeChanges } from "../app/lib/task-activity";

const base = {
  id: 1, subject: "Ship it", description: "", owner: "Ada Lovelace", collaborators: [] as string[], recipients: [] as string[],
  due: "2026-08-20", source: "Manual", topic: "General", project: "Pilot", recurringMeeting: "Weekly call", status: "Open", created: "2026-08-18", createdBy: "Ada Lovelace", updates: [] as { text: string; at: string; by?: string }[],
};

test("describeChanges reports a readable line per changed scalar field", () => {
  const lines = describeChanges(base, { ...base, due: "2026-08-25", status: "In progress" });
  assert.ok(lines.some(line => /changed due date from "2026-08-20" to "2026-08-25"/.test(line)));
  assert.ok(lines.some(line => /changed status from "Open" to "In progress"/.test(line)));
  assert.equal(lines.length, 2);
});

test("describeChanges reports added/removed coworkers and recipients separately", () => {
  const lines = describeChanges(
    { ...base, collaborators: ["Maya Chen"], recipients: [] },
    { ...base, collaborators: ["Maya Chen", "Drew Foster"], recipients: ["Payneet Kaur"] },
  );
  assert.ok(lines.includes("added Drew Foster as coworker"));
  assert.ok(lines.includes("added Payneet Kaur as recipient"));
  assert.equal(lines.length, 2);
});

test("describeChanges collapses a description edit to one generic line, never leaks the text, and reports nothing when nothing changed", () => {
  const lines = describeChanges(base, { ...base, description: "New details that should not appear verbatim" });
  assert.deepEqual(lines, ["updated the description"]);
  assert.equal(describeChanges(base, { ...base }).length, 0);
});

test("describeChanges never reports on the updates field — that's the separate Status Updates log", () => {
  const lines = describeChanges(base, { ...base, updates: [{ text: "progress note", at: "2026-08-19T00:00:00Z", by: "Ada" }] });
  assert.equal(lines.length, 0);
});

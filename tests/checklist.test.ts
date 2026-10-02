import assert from "node:assert/strict";
import test from "node:test";
import { addChecklistItem, applyChecklistSelection, checklistJustAdvanced, describeChecklistChanges, matchChecklistItem, removeChecklistItem, toggleChecklistItem } from "../app/lib/checklist";

test("addChecklistItem: appends a new, unchecked item", () => {
  const result = addChecklistItem([], "1", "Call Bernd");
  assert.deepEqual(result, [{ id: "1", text: "Call Bernd", done: false }]);
});

test("addChecklistItem: trims whitespace", () => {
  const result = addChecklistItem([], "1", "  Call Bernd  ");
  assert.equal(result[0].text, "Call Bernd");
});

test("addChecklistItem: blank text (all whitespace) is a no-op", () => {
  const before = [{ id: "1", text: "Existing", done: false }];
  assert.deepEqual(addChecklistItem(before, "2", "   "), before);
});

test("removeChecklistItem: drops only the matching id", () => {
  const before = [{ id: "1", text: "A", done: false }, { id: "2", text: "B", done: false }];
  assert.deepEqual(removeChecklistItem(before, "1"), [{ id: "2", text: "B", done: false }]);
});

test("toggleChecklistItem: flips only the matching item's done flag", () => {
  const before = [{ id: "1", text: "A", done: false }, { id: "2", text: "B", done: false }];
  assert.deepEqual(toggleChecklistItem(before, "1", true), [{ id: "1", text: "A", done: true }, { id: "2", text: "B", done: false }]);
});

test("checklistJustAdvanced: true when an item newly becomes done", () => {
  const before = [{ id: "1", text: "A", done: false }];
  const after = [{ id: "1", text: "A", done: true }];
  assert.equal(checklistJustAdvanced(before, after), true);
});

test("checklistJustAdvanced: false when nothing changed", () => {
  const same = [{ id: "1", text: "A", done: true }];
  assert.equal(checklistJustAdvanced(same, same), false);
});

test("checklistJustAdvanced: false when an item is unchecked, not checked", () => {
  const before = [{ id: "1", text: "A", done: true }];
  const after = [{ id: "1", text: "A", done: false }];
  assert.equal(checklistJustAdvanced(before, after), false);
});

test("checklistJustAdvanced: false when a new item is added but not checked", () => {
  const before = [{ id: "1", text: "A", done: false }];
  const after = [{ id: "1", text: "A", done: false }, { id: "2", text: "B", done: false }];
  assert.equal(checklistJustAdvanced(before, after), false);
});

test("applyChecklistSelection: marks visible ids done/undone per the reported set, leaves others untouched", () => {
  const checklist = [
    { id: "1", text: "A", done: false },
    { id: "2", text: "B", done: true },
    { id: "3", text: "C (not shown in Slack)", done: false },
  ];
  const result = applyChecklistSelection(checklist, ["1", "2"], new Set(["1"]));
  assert.deepEqual(result, [
    { id: "1", text: "A", done: true },
    { id: "2", text: "B", done: false },
    { id: "3", text: "C (not shown in Slack)", done: false },
  ]);
});

test("matchChecklistItem: an exact (case-insensitive) match wins outright", () => {
  const checklist = [{ id: "1", text: "Call Bernd", done: false }, { id: "2", text: "Send the invoice", done: false }];
  assert.equal(matchChecklistItem(checklist, "call bernd")?.id, "1");
});

test("matchChecklistItem: falls back to a substring match either direction", () => {
  const checklist = [{ id: "1", text: "Send the Slack message to the team", done: false }];
  assert.equal(matchChecklistItem(checklist, "slack message")?.id, "1");
  assert.equal(matchChecklistItem([{ id: "2", text: "Slack", done: false }], "send the slack message to the team")?.id, "2");
});

test("matchChecklistItem: prefers the longest overlapping item when more than one matches", () => {
  const checklist = [{ id: "1", text: "Call Bernd", done: false }, { id: "2", text: "Call Bernd about the invoice", done: false }];
  assert.equal(matchChecklistItem(checklist, "call bernd")?.id, "1"); // exact match still wins over a longer partial one
  assert.equal(matchChecklistItem(checklist, "bernd")?.id, "2"); // no exact match — the longer of the two overlapping items wins
});

test("matchChecklistItem: returns null for an empty checklist, empty phrase, or no overlap at all", () => {
  assert.equal(matchChecklistItem([], "anything"), null);
  assert.equal(matchChecklistItem([{ id: "1", text: "Call Bernd", done: false }], ""), null);
  assert.equal(matchChecklistItem([{ id: "1", text: "Call Bernd", done: false }], "send the invoice"), null);
});

test("describeChecklistChanges: reports a newly-added item", () => {
  const before = [{ id: "1", text: "A", done: false }];
  const after = [{ id: "1", text: "A", done: false }, { id: "2", text: "B", done: false }];
  assert.deepEqual(describeChecklistChanges(before, after), ['added "B" to the checklist']);
});

test("describeChecklistChanges: reports checked and unchecked items separately", () => {
  const before = [{ id: "1", text: "A", done: false }, { id: "2", text: "B", done: true }];
  const after = [{ id: "1", text: "A", done: true }, { id: "2", text: "B", done: false }];
  assert.deepEqual(describeChecklistChanges(before, after), ['checked off "A"', 'unchecked "B"']);
});

test("describeChecklistChanges: nothing to report when nothing changed", () => {
  const same = [{ id: "1", text: "A", done: true }];
  assert.deepEqual(describeChecklistChanges(same, same), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { addChecklistItem, applyChecklistSelection, checklistJustAdvanced, removeChecklistItem, toggleChecklistItem } from "../app/lib/checklist";

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

import assert from "node:assert/strict";
import test from "node:test";
import { groupOptions } from "../app/lib/picklist";

const options = ["Xenofon Papadopoulos", "Shankar Iyer", "Drew Halloran", "Ada Lovelace"];

test("groupOptions pins the current selection, in pick order, ahead of everyone else when there's no search query", () => {
  const { pinned, rest } = groupOptions(options, ["Drew Halloran", "Shankar Iyer"], "");
  assert.deepEqual(pinned, ["Drew Halloran", "Shankar Iyer"], "pick order preserved, not options-list order");
  assert.deepEqual(rest, ["Xenofon Papadopoulos", "Ada Lovelace"]);
});

test("groupOptions keeps a selected option pinned even when it doesn't match the current search query — the whole point of pinning", () => {
  const { pinned, rest } = groupOptions(options, ["Shankar Iyer"], "drew");
  assert.deepEqual(pinned, ["Shankar Iyer"], "still visible and removable, even though \"drew\" doesn't match his name");
  assert.deepEqual(rest, ["Drew Halloran"]);
});

test("groupOptions never puts an already-selected option in rest too, even when it matches the query", () => {
  const { rest } = groupOptions(options, ["Shankar Iyer"], "iyer");
  assert.deepEqual(rest, [], "he's already pinned - no duplicate row below");
});

test("groupOptions pins a selected value that's no longer in the known options list at all, rather than dropping it", () => {
  const { pinned, rest } = groupOptions(options, ["Someone Since Removed"], "");
  assert.deepEqual(pinned, ["Someone Since Removed"]);
  assert.ok(!rest.includes("Someone Since Removed"));
});

test("groupOptions matches a search query anywhere in the name, not just the start, case-insensitively", () => {
  const { rest } = groupOptions(options, [], "FON");
  assert.deepEqual(rest, ["Xenofon Papadopoulos"]);
});

test("groupOptions returns everything unfiltered, in original order, for an empty or whitespace-only query", () => {
  assert.deepEqual(groupOptions(options, [], "   ").rest, options);
});

test("groupOptions returns an empty rest when nothing matches, and an empty pinned when nothing is selected", () => {
  assert.deepEqual(groupOptions(options, [], "zzz"), { pinned: [], rest: [] });
});

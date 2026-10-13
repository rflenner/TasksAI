import assert from "node:assert/strict";
import test from "node:test";
import { commitTitle } from "../app/lib/editable-title";

test("commitTitle: a changed heading is saved, trimmed", () => {
  assert.equal(commitTitle("Send the proposal", "  Send the revised proposal  "), "Send the revised proposal");
});

test("commitTitle: nothing to save when it didn't change (also ignoring stray spaces)", () => {
  assert.equal(commitTitle("Send the proposal", "Send the proposal"), null);
  assert.equal(commitTitle("Send the proposal", "  Send the proposal "), null);
});

test("commitTitle: an emptied heading is never saved — the subject goes back to what it was", () => {
  assert.equal(commitTitle("Send the proposal", ""), null);
  assert.equal(commitTitle("Send the proposal", "   \n "), null);
});

test("commitTitle: line breaks (a pasted multi-line subject) become single spaces", () => {
  assert.equal(commitTitle("Old", "First line\nsecond   line"), "First line second line");
});

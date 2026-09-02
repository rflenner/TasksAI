import assert from "node:assert/strict";
import test from "node:test";
import { buildGlossary, KEYTERM_BUDGET_CHARS, KEYTERM_MAX_CHARS } from "../app/lib/glossary";

test("buildGlossary: short, ordinary values all pass through unchanged", () => {
  assert.deepEqual(buildGlossary(["Drew Klein", "Sales AI", "Pilot"]), ["Drew Klein", "Sales AI", "Pilot"]);
});

test("buildGlossary: trims surrounding whitespace and drops blank/whitespace-only entries", () => {
  assert.deepEqual(buildGlossary(["  Drew Klein  ", "", "   ", "Pilot"]), ["Drew Klein", "Pilot"]);
});

test("buildGlossary: drops any single term longer than KEYTERM_MAX_CHARS instead of truncating it", () => {
  const sentence = "up session with Sudanshu to clarify and refine these features. quote";
  assert.ok(sentence.length > KEYTERM_MAX_CHARS, "fixture must exceed the per-term cap to actually exercise this");
  assert.deepEqual(buildGlossary([sentence, "Pilot"]), ["Pilot"]);
});

test("buildGlossary: a term exactly at the length cap is kept, one character over is dropped", () => {
  const atCap = "a".repeat(KEYTERM_MAX_CHARS);
  const overCap = "a".repeat(KEYTERM_MAX_CHARS + 1);
  assert.deepEqual(buildGlossary([atCap]), [atCap]);
  assert.deepEqual(buildGlossary([overCap]), []);
});

test("buildGlossary: stops adding once the combined length would exceed the total budget, keeping everything that already fit", () => {
  const term = "x".repeat(30); // divides evenly into the budget for an exact boundary test
  const count = Math.floor(KEYTERM_BUDGET_CHARS / term.length);
  const values = Array.from({ length: count + 5 }, () => term);
  const glossary = buildGlossary(values);
  assert.equal(glossary.length, count);
  assert.ok(glossary.reduce((sum, t) => sum + t.length, 0) <= KEYTERM_BUDGET_CHARS);
});

test("buildGlossary: a real-world mix — long sentence dropped, budget respected, order preserved for what's kept", () => {
  const values = ["Drew Klein", "up session with Sudanshu to clarify and refine these features. quote", "Sales AI", "Marketing Sales AI launch"];
  assert.deepEqual(buildGlossary(values), ["Drew Klein", "Sales AI", "Marketing Sales AI launch"]);
});

test("buildGlossary: empty input returns an empty list", () => {
  assert.deepEqual(buildGlossary([]), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ITEMS, sanitizeActivity, summaryInput } from "../app/lib/close-plan-summary";

// Fictional data only — this repository is public.
test("sanitizeActivity keeps date, name and line, and drops malformed items", () => {
  const items = sanitizeActivity([
    { at: "2026-10-01T09:00:00Z", who: "  Olivia   Grant ", text: "closed “Define use cases”" },
    { at: "not a date", who: "X", text: "ignored" },
    { at: "2026-10-01", who: "", text: "added “Reference call”" },
    { at: "2026-10-01", who: "Y" },
    "nonsense",
    null,
  ]);
  assert.deepEqual(items, [
    { at: "2026-10-01", who: "Olivia Grant", text: "closed “Define use cases”" },
    { at: "2026-10-01", who: "Someone", text: "added “Reference call”" },
  ]);
});

test("sanitizeActivity bounds the number of items and the length of each line", () => {
  const many = Array.from({ length: MAX_ITEMS + 20 }, (_, i) => ({ at: "2026-10-01", who: "A", text: `line ${i} ` + "x".repeat(500) }));
  const items = sanitizeActivity(many);
  assert.equal(items.length, MAX_ITEMS);
  assert.ok(items.every(i => i.text.length <= 300));
  assert.deepEqual(sanitizeActivity("not an array"), []);
});

test("summaryInput lists the plan and the activity lines", () => {
  const text = summaryInput("Rollout for Meridian Biotech", [{ at: "2026-10-01", who: "Lukas Brenner", text: "posted an update on “Agree scope”" }]);
  assert.match(text, /^Plan: Rollout for Meridian Biotech/);
  assert.match(text, /2026-10-01 · Lukas Brenner posted an update on “Agree scope”/);
});

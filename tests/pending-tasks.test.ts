import assert from "node:assert/strict";
import test from "node:test";
import { endOfThisWeek } from "../app/lib/pending-tasks";

test("endOfThisWeek resolves to the coming Sunday, inclusive of a Sunday itself", () => {
  assert.equal(endOfThisWeek(new Date("2026-08-18T09:00:00Z")), "2026-08-23"); // Tuesday -> Sunday
  assert.equal(endOfThisWeek(new Date("2026-08-17T09:00:00Z")), "2026-08-23"); // Monday -> same Sunday
  assert.equal(endOfThisWeek(new Date("2026-08-23T09:00:00Z")), "2026-08-23"); // Sunday -> itself
});

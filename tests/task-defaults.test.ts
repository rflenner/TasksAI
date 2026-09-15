import assert from "node:assert/strict";
import test from "node:test";
import { defaultDueDate, resolveDueDate } from "../app/lib/task-defaults";

test("defaultDueDate adds 7 calendar days by default, including weekends", () => {
  assert.equal(defaultDueDate("2026-09-02"), "2026-09-09"); // a Wednesday, +7 -> the following Wednesday
});

test("defaultDueDate rolls over a month boundary correctly", () => {
  assert.equal(defaultDueDate("2026-09-28"), "2026-10-05");
});

test("defaultDueDate only reads the date portion, ignoring any time/offset already on the reference string", () => {
  assert.equal(defaultDueDate("2026-09-02T09:05:38.509Z"), "2026-09-09");
});

test("defaultDueDate honors a custom day count", () => {
  assert.equal(defaultDueDate("2026-09-02", 3), "2026-09-05");
});

test("resolveDueDate passes a genuine YYYY-MM-DD straight through, unchanged", () => {
  assert.equal(resolveDueDate("2026-09-20", "2026-09-02"), "2026-09-20");
});

test("resolveDueDate falls back to defaultDueDate for an empty string, null, or undefined", () => {
  assert.equal(resolveDueDate("", "2026-09-02"), "2026-09-09");
  assert.equal(resolveDueDate(null, "2026-09-02"), "2026-09-09");
  assert.equal(resolveDueDate(undefined, "2026-09-02"), "2026-09-09");
});

test("resolveDueDate falls back for a stray non-date string rather than storing garbage", () => {
  assert.equal(resolveDueDate("next week", "2026-09-02"), "2026-09-09");
});

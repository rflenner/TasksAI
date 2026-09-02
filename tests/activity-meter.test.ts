import assert from "node:assert/strict";
import test from "node:test";
import { summarizeActivity } from "../app/lib/activity-meter";

const NOW = new Date("2026-09-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

test("summarizeActivity: active events outweigh passive ones 3:1 in the score", () => {
  const stats = summarizeActivity([{ name: "Ada", at: daysAgo(1), kind: "active" }], NOW);
  assert.equal(stats.get("Ada")!.last30Days.score, 3);
  const passiveOnly = summarizeActivity([{ name: "Ada", at: daysAgo(1), kind: "passive" }], NOW);
  assert.equal(passiveOnly.get("Ada")!.last30Days.score, 1);
});

test("summarizeActivity: active and passive counts are tracked independently, both feed the same score", () => {
  const stats = summarizeActivity([
    { name: "Ada", at: daysAgo(1), kind: "active" },
    { name: "Ada", at: daysAgo(2), kind: "active" },
    { name: "Ada", at: daysAgo(3), kind: "passive" },
  ], NOW);
  const window = stats.get("Ada")!.last30Days;
  assert.equal(window.active, 2);
  assert.equal(window.passive, 1);
  assert.equal(window.score, 2 * 3 + 1 * 1);
});

test("summarizeActivity: events outside the 30-day window count toward all-time but not last30Days", () => {
  const stats = summarizeActivity([
    { name: "Ada", at: daysAgo(5), kind: "active" },
    { name: "Ada", at: daysAgo(45), kind: "active" },
  ], NOW);
  const s = stats.get("Ada")!;
  assert.equal(s.last30Days.active, 1);
  assert.equal(s.allTime.active, 2);
});

test("summarizeActivity: a person with no events at all simply has no entry in the map", () => {
  const stats = summarizeActivity([{ name: "Ada", at: daysAgo(1), kind: "active" }], NOW);
  assert.equal(stats.get("Drew Klein"), undefined);
});

test("summarizeActivity: an event exactly WINDOW_DAYS ago is still inside the window (inclusive boundary)", () => {
  const stats = summarizeActivity([{ name: "Ada", at: daysAgo(30), kind: "active" }], NOW);
  assert.equal(stats.get("Ada")!.last30Days.active, 1);
});

test("summarizeActivity: an event with a blank name is ignored rather than creating a bogus entry", () => {
  const stats = summarizeActivity([{ name: "", at: daysAgo(1), kind: "active" }], NOW);
  assert.equal(stats.size, 0);
});

test("summarizeActivity: multiple people are tracked independently", () => {
  const stats = summarizeActivity([
    { name: "Ada", at: daysAgo(1), kind: "active" },
    { name: "Drew Klein", at: daysAgo(1), kind: "passive" },
  ], NOW);
  assert.equal(stats.get("Ada")!.last30Days.score, 3);
  assert.equal(stats.get("Drew Klein")!.last30Days.score, 1);
});

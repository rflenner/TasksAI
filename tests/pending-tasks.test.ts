import assert from "node:assert/strict";
import test from "node:test";
import { classifyForDigest, endOfThisWeek } from "../app/lib/pending-tasks";

test("endOfThisWeek resolves to the coming Sunday, inclusive of a Sunday itself", () => {
  assert.equal(endOfThisWeek(new Date("2026-08-18T09:00:00Z")), "2026-08-23"); // Tuesday -> Sunday
  assert.equal(endOfThisWeek(new Date("2026-08-17T09:00:00Z")), "2026-08-23"); // Monday -> same Sunday
  assert.equal(endOfThisWeek(new Date("2026-08-23T09:00:00Z")), "2026-08-23"); // Sunday -> itself
});

const closedSince = new Date("2026-08-19T00:00:00Z");
const collaborator = { name: "Ada", role: "collaborator" as const };
const readonly = { name: "Ada", role: "readonly" as const };
const base = { owner: "Someone Else", collaborators: [] as string[], recipients: [] as string[], status: "Open", closedAt: null as Date | null };

test("classifyForDigest sorts an open task by relationship: owner and coworker both land in myTasks, recipient-only lands in delegatedTasks", () => {
  assert.equal(classifyForDigest({ ...base, owner: "Ada" }, collaborator, closedSince), "myTasks");
  assert.equal(classifyForDigest({ ...base, collaborators: ["Ada"] }, collaborator, closedSince), "myTasks");
  assert.equal(classifyForDigest({ ...base, recipients: ["Ada"] }, collaborator, closedSince), "delegatedTasks");
  assert.equal(classifyForDigest(base, collaborator, closedSince), null);
});

test("classifyForDigest prioritizes myTasks over delegatedTasks when someone is both owner/coworker and recipient on the same task", () => {
  assert.equal(classifyForDigest({ ...base, owner: "Ada", recipients: ["Ada"] }, collaborator, closedSince), "myTasks");
});

test("classifyForDigest restricts a readonly actor to recipient only, even if the data also lists them as owner or coworker", () => {
  assert.equal(classifyForDigest({ ...base, owner: "Ada" }, readonly, closedSince), null);
  assert.equal(classifyForDigest({ ...base, collaborators: ["Ada"] }, readonly, closedSince), null);
  assert.equal(classifyForDigest({ ...base, recipients: ["Ada"] }, readonly, closedSince), "delegatedTasks");
});

test("classifyForDigest only surfaces a closed task if it's within the lookback window and has a closedAt at all", () => {
  const closedTask = { ...base, owner: "Ada", status: "Closed" };
  assert.equal(classifyForDigest({ ...closedTask, closedAt: new Date("2026-08-20T00:00:00Z") }, collaborator, closedSince), "recentlyClosed", "closed after the cutoff: included");
  assert.equal(classifyForDigest({ ...closedTask, closedAt: new Date("2026-08-10T00:00:00Z") }, collaborator, closedSince), null, "closed well before the cutoff: excluded");
  assert.equal(classifyForDigest({ ...closedTask, closedAt: null }, collaborator, closedSince), null, "closed with no recorded closedAt (pre-feature data): excluded, never shown with a blank date");
  assert.equal(classifyForDigest({ ...closedTask, owner: "Someone Else", closedAt: new Date("2026-08-20T00:00:00Z") }, collaborator, closedSince), null, "closed but no personal relationship: excluded");
});

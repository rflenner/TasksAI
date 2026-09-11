import assert from "node:assert/strict";
import test from "node:test";
import { hasUnseenUpdateFor, isTaskNewFor, newlyAssignedPeople, NEW_FLAG_WINDOW_MS, parseCreatedAt } from "../app/lib/task-flags";

function task(overrides: Partial<{ status: string; updates: unknown[]; created: string }> = {}) {
  return { status: "Open", updates: [] as unknown[], created: "2026-09-09", ...overrides };
}

const NOW = new Date("2026-09-09T12:00:00Z").getTime();

test("parseCreatedAt: a bare YYYY-MM-DD anchors to noon UTC, same convention as speakableDate/formatCreatedDay elsewhere", () => {
  assert.equal(parseCreatedAt("2026-09-08"), new Date("2026-09-08T12:00:00Z").getTime());
});
test("parseCreatedAt: a full ISO timestamp is used as-is, not re-anchored to noon", () => {
  assert.equal(parseCreatedAt("2026-09-08T03:15:00.000Z"), new Date("2026-09-08T03:15:00.000Z").getTime());
});

test("isTaskNewFor: freshly created, never viewed, within 72h -> new", () => {
  assert.equal(isTaskNewFor(task({ created: "2026-09-08" }), NOW, null, null), true);
});
test("isTaskNewFor: freshly created but already viewed since -> not new", () => {
  const viewedAt = new Date("2026-09-08T13:00:00Z").getTime();
  assert.equal(isTaskNewFor(task({ created: "2026-09-08" }), NOW, viewedAt, null), false);
});
test("isTaskNewFor: created more than 72h ago -> not new, even if never viewed", () => {
  assert.equal(isTaskNewFor(task({ created: "2026-09-01" }), NOW, null, null), false);
});
test("isTaskNewFor: status isn't Open -> never new, regardless of view/assignment", () => {
  assert.equal(isTaskNewFor(task({ status: "In progress", created: "2026-09-09" }), NOW, null, null), false);
});
test("isTaskNewFor: has a status update -> never new, even freshly created and unviewed", () => {
  assert.equal(isTaskNewFor(task({ created: "2026-09-09", updates: [{ text: "x", at: "2026-09-09T12:00:00Z" }] }), NOW, null, null), false);
});
test("isTaskNewFor: an existing (old) task freshly assigned, never viewed since -> new", () => {
  const assignedAt = NOW - 60 * 60 * 1000; // 1 hour ago
  assert.equal(isTaskNewFor(task({ created: "2026-01-01" }), NOW, null, assignedAt), true);
});
test("isTaskNewFor: assigned, but viewed again after the assignment -> not new", () => {
  const assignedAt = NOW - 60 * 60 * 1000;
  const viewedAt = NOW - 30 * 60 * 1000; // viewed after assignment
  assert.equal(isTaskNewFor(task({ created: "2026-01-01" }), NOW, viewedAt, assignedAt), false);
});
test("isTaskNewFor: assigned, but the only view predates the assignment -> still new (that view doesn't count)", () => {
  const assignedAt = NOW - 60 * 60 * 1000;
  const viewedAt = NOW - 2 * 60 * 60 * 1000; // viewed before assignment
  assert.equal(isTaskNewFor(task({ created: "2026-01-01" }), NOW, viewedAt, assignedAt), true);
});
test("isTaskNewFor: assignment older than 72h -> not new", () => {
  const assignedAt = NOW - (NEW_FLAG_WINDOW_MS + 1000);
  assert.equal(isTaskNewFor(task({ created: "2026-01-01" }), NOW, null, assignedAt), false);
});
test("isTaskNewFor: created flag and assigned flag are independent — either one alone is enough", () => {
  // Old task, no assignment record at all, never viewed — created-based
  // reason is the only one that could apply, and it's outside the
  // window, so this should read as not-new (guards against the
  // assignment check accidentally supplying a false positive).
  assert.equal(isTaskNewFor(task({ created: "2026-01-01" }), NOW, null, null), false);
});

const upd = (at: string, by?: string) => ({ at, by, text: "note" });

test("hasUnseenUpdateFor: an update posted, task never opened by this person -> unseen", () => {
  assert.equal(hasUnseenUpdateFor({ updates: [upd("2026-09-09T10:00:00Z")] }, "Ada", null), true);
});
test("hasUnseenUpdateFor: no updates at all -> nothing to be unseen", () => {
  assert.equal(hasUnseenUpdateFor({ updates: [] }, "Ada", null), false);
});
test("hasUnseenUpdateFor: latest update predates this person's last view -> seen", () => {
  const viewedAt = new Date("2026-09-09T12:00:00Z").getTime();
  assert.equal(hasUnseenUpdateFor({ updates: [upd("2026-09-09T10:00:00Z")] }, "Ada", viewedAt), false);
});
test("hasUnseenUpdateFor: latest update posted after this person's last view -> unseen", () => {
  const viewedAt = new Date("2026-09-09T09:00:00Z").getTime();
  assert.equal(hasUnseenUpdateFor({ updates: [upd("2026-09-09T10:00:00Z")] }, "Ada", viewedAt), true);
});
test("hasUnseenUpdateFor: only the LATEST update matters — an old unseen one behind a seen one doesn't count", () => {
  const viewedAt = new Date("2026-09-09T11:00:00Z").getTime();
  const updates = [upd("2026-09-08T10:00:00Z"), upd("2026-09-09T10:00:00Z")]; // both before the view
  assert.equal(hasUnseenUpdateFor({ updates }, "Ada", viewedAt), false);
});
test("hasUnseenUpdateFor: the person's OWN latest update is never flagged back at them", () => {
  assert.equal(hasUnseenUpdateFor({ updates: [upd("2026-09-09T10:00:00Z", "Ada")] }, "Ada", null), false);
});
test("hasUnseenUpdateFor: someone else's latest update still flags even if an earlier one was mine", () => {
  const updates = [upd("2026-09-09T09:00:00Z", "Ada"), upd("2026-09-09T10:00:00Z", "Grace")];
  assert.equal(hasUnseenUpdateFor({ updates }, "Ada", null), true);
});
test("hasUnseenUpdateFor: an unparseable legacy timestamp ('18 Aug, 09:42') is treated as can't-tell, not flagged", () => {
  assert.equal(hasUnseenUpdateFor({ updates: [upd("18 Aug, 09:42")] }, "Ada", null), false);
});

const before = { owner: "Ada Lovelace", collaborators: ["Grace Hopper"], recipients: [] as string[] };

test("newlyAssignedPeople: owner change reports the new owner only, not the old one", () => {
  assert.deepEqual(newlyAssignedPeople(before, { ...before, owner: "Alan Turing" }), ["Alan Turing"]);
});
test("newlyAssignedPeople: owner unchanged reports nothing for owner", () => {
  assert.deepEqual(newlyAssignedPeople(before, { ...before }), []);
});
test("newlyAssignedPeople: a newly added collaborator is reported, a removed one is not", () => {
  assert.deepEqual(newlyAssignedPeople(before, { ...before, collaborators: ["Margaret Hamilton"] }), ["Margaret Hamilton"]);
});
test("newlyAssignedPeople: a newly added recipient is reported", () => {
  assert.deepEqual(newlyAssignedPeople(before, { ...before, recipients: ["Katherine Johnson"] }), ["Katherine Johnson"]);
});
test("newlyAssignedPeople: the same person added in two fields at once is de-duplicated", () => {
  const names = newlyAssignedPeople(before, { ...before, owner: "Margaret Hamilton", recipients: ["Margaret Hamilton"] });
  assert.deepEqual(names, ["Margaret Hamilton"]);
});
test("newlyAssignedPeople: nothing changed -> empty list", () => {
  assert.deepEqual(newlyAssignedPeople(before, before), []);
});

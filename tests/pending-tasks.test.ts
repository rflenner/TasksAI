import assert from "node:assert/strict";
import test from "node:test";
import { classifyForDigest, endOfThisWeek, isNewlyAssigned, taskLineFor, tasksReferencingName } from "../app/lib/pending-tasks";

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

const sinceIso = "2026-08-19T00:00:00.000Z";
const assignBase = { owner: "Someone Else", collaborators: [] as string[], recipients: [] as string[] };
test("isNewlyAssigned matches classifyForDigest's relationship rule: owner and coworker both count, recipient-only counts too, no relationship doesn't", () => {
  assert.equal(isNewlyAssigned({ ...assignBase, owner: "Ada", created: "2026-08-20T00:00:00.000Z" }, collaborator, sinceIso), true);
  assert.equal(isNewlyAssigned({ ...assignBase, collaborators: ["Ada"], created: "2026-08-20T00:00:00.000Z" }, collaborator, sinceIso), true);
  assert.equal(isNewlyAssigned({ ...assignBase, recipients: ["Ada"], created: "2026-08-20T00:00:00.000Z" }, collaborator, sinceIso), true);
  assert.equal(isNewlyAssigned({ ...assignBase, created: "2026-08-20T00:00:00.000Z" }, collaborator, sinceIso), false);
});
test("isNewlyAssigned restricts a readonly actor to recipient only, same as classifyForDigest", () => {
  assert.equal(isNewlyAssigned({ ...assignBase, owner: "Ada", created: "2026-08-20T00:00:00.000Z" }, readonly, sinceIso), false);
  assert.equal(isNewlyAssigned({ ...assignBase, recipients: ["Ada"], created: "2026-08-20T00:00:00.000Z" }, readonly, sinceIso), true);
});
test("isNewlyAssigned is keyed off created vs. the lookback cutoff, regardless of status — a task created before the window is excluded even with a live relationship, one right at the cutoff is included", () => {
  assert.equal(isNewlyAssigned({ ...assignBase, owner: "Ada", created: "2026-08-10T00:00:00.000Z" }, collaborator, sinceIso), false, "created well before the cutoff: excluded");
  assert.equal(isNewlyAssigned({ ...assignBase, owner: "Ada", created: sinceIso }, collaborator, sinceIso), true, "created exactly at the cutoff: included");
});

// tasksReferencingName / taskLineFor back the external-invite feature: a
// task can name someone by a plain string before they ever have an
// account, so matching works purely off that string — no id required.
test("tasksReferencingName finds a name in any of owner/coworker/recipient, excludes closed tasks, and doesn't require an account to exist", () => {
  const jane = { ...base, owner: "Jane Doe" };
  const bySpelling = { ...base, collaborators: ["Jane Doe"] };
  const asRecipient = { ...base, recipients: ["Jane Doe"] };
  const closed = { ...base, owner: "Jane Doe", status: "Closed" };
  const unrelated = { ...base, owner: "Someone Else" };
  assert.deepEqual(tasksReferencingName([jane, bySpelling, asRecipient, closed, unrelated], "Jane Doe"), [jane, bySpelling, asRecipient]);
  assert.deepEqual(tasksReferencingName([unrelated], "Jane Doe"), []);
});

test("taskLineFor reports the matched name's role and marks a task overdue only when open", () => {
  const today = "2026-08-20";
  const owned = taskLineFor({ subject: "Ship it", description: "", project: "", topic: "", recurringMeeting: "", due: "2026-08-10", status: "Open", owner: "Jane Doe", collaborators: [], recipients: [], closedAt: null }, "Jane Doe", today);
  assert.equal(owned.role, "Owner");
  assert.equal(owned.overdue, true);
  const delegated = taskLineFor({ subject: "Review", description: "", project: "", topic: "", recurringMeeting: "", due: "2026-08-10", status: "Closed", owner: "Someone Else", collaborators: [], recipients: ["Jane Doe"], closedAt: new Date("2026-08-19T00:00:00Z") }, "Jane Doe", today);
  assert.equal(delegated.role, "Recipient");
  assert.equal(delegated.overdue, false, "a closed task is never reported as overdue even if its due date has passed");
  assert.equal(delegated.closedAt, "2026-08-19");
});

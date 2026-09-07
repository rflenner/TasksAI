import assert from "node:assert/strict";
import test from "node:test";
import { compareForDuplicate, findDuplicateCandidates, textSimilarity, type StoredTask } from "../app/lib/task-merge";

let nextId = 1;
function baseTask(overrides: Partial<StoredTask> = {}): StoredTask {
  return {
    id: nextId++, subject: "Send updated pilot proposal", description: "", owner: "Rizan Flenner",
    collaborators: [], recipients: [], due: "", source: "Sales AI", topic: "", project: "", recurringMeeting: "",
    status: "Open", priority: "Low", created: "2026-09-08", createdBy: null, updates: [], closedAt: null,
    externalSource: "sales-ai", externalId: `ext-${nextId}`, accountId: null, accountName: null,
    opportunityId: null, opportunityName: null, meetingId: null, citationUser: null, citationQuote: null,
    ownerContactId: null, recipientContactIds: {}, mergedIntoTaskId: null,
    ...overrides,
  };
}

test("textSimilarity: the exact real pair found live — 'playbook to Pavneet' vs 'playbook visuals to Pavneet' scores high", () => {
  const score = textSimilarity("Send sales progression playbook to Pavneet", "Send sales progression playbook visuals to Pavneet");
  assert.ok(score > 0.8, `expected high similarity, got ${score}`);
});

test("textSimilarity: completely unrelated subjects score 0", () => {
  assert.equal(textSimilarity("Schedule a demo for Acme", "Renew the security certificate"), 0);
});

test("textSimilarity: empty text on either side scores 0, doesn't throw", () => {
  assert.equal(textSimilarity("", "Send pricing sheet"), 0);
  assert.equal(textSimilarity("Send pricing sheet", ""), 0);
  assert.equal(textSimilarity("", ""), 0);
});

test("compareForDuplicate: same meeting + similar wording + same created day => duplicate", () => {
  const a = baseTask({ subject: "Send sales progression playbook to Pavneet", meetingId: "m-1", created: "2026-09-08" });
  const b = baseTask({ subject: "Send sales progression playbook visuals to Pavneet", meetingId: "m-1", created: "2026-09-08" });
  const result = compareForDuplicate(a, b);
  assert.ok(result, "expected a candidate, got null");
  assert.equal(result!.relationship, "duplicate");
  assert.ok(result!.reasons.some(r => r.includes("same Sales AI meeting")));
});

test("compareForDuplicate: same meeting, different created dates => possible-update, older task is suggested primary", () => {
  const earlier = baseTask({ subject: "Send sales progression playbook to Pavneet", meetingId: "m-1", created: "2026-09-01" });
  const later = baseTask({ subject: "Send sales progression playbook visuals to Pavneet", meetingId: "m-1", created: "2026-09-08" });
  const result = compareForDuplicate(later, earlier); // order shouldn't matter
  assert.ok(result);
  assert.equal(result!.relationship, "possible-update");
  assert.equal(result!.olderId, earlier.id);
  assert.equal(result!.newerId, later.id);
});

test("compareForDuplicate: different (both non-null) meeting ids => possible-update even on the same day", () => {
  const a = baseTask({ subject: "Send sales progression playbook to Pavneet", meetingId: "m-1", accountId: "acc-1", created: "2026-09-08" });
  const b = baseTask({ subject: "Send sales progression playbook visuals to Pavneet", meetingId: "m-2", accountId: "acc-1", created: "2026-09-08" });
  const result = compareForDuplicate(a, b);
  assert.ok(result);
  assert.equal(result!.relationship, "possible-update");
});

test("compareForDuplicate: same account only, unrelated subjects, no shared people => below threshold, null", () => {
  const a = baseTask({ subject: "Schedule a demo", accountId: "acc-1" });
  const b = baseTask({ subject: "Renew the security certificate", accountId: "acc-1" });
  assert.equal(compareForDuplicate(a, b), null);
});

test("compareForDuplicate: shared people alone (no meeting/account/opportunity) contributes but isn't enough on its own", () => {
  const a = baseTask({ subject: "Schedule a demo", owner: "Maya Chen", recipients: ["Drew Foster"] });
  const b = baseTask({ subject: "Renew the security certificate", owner: "Maya Chen", recipients: ["Drew Foster"] });
  assert.equal(compareForDuplicate(a, b), null);
});

test("compareForDuplicate: identical task id returns null (never a duplicate of itself)", () => {
  const a = baseTask({ id: 42 });
  assert.equal(compareForDuplicate(a, { ...a }), null);
});

test("findDuplicateCandidates: surfaces the true duplicate, skips an already-merged task, skips an unrelated one, ignores pairs with nothing in common", () => {
  const primary = baseTask({ subject: "Send sales progression playbook to Pavneet", meetingId: "m-1", created: "2026-09-08" });
  const dup = baseTask({ subject: "Send sales progression playbook visuals to Pavneet", meetingId: "m-1", created: "2026-09-08" });
  const alreadyMerged = baseTask({ subject: "Send sales progression playbook to Pavneet, take 3", meetingId: "m-1", mergedIntoTaskId: primary.id });
  const unrelated = baseTask({ subject: "Completely different task about something else entirely" });

  const candidates = findDuplicateCandidates([primary, dup, alreadyMerged, unrelated]);
  assert.equal(candidates.length, 1);
  assert.deepEqual([candidates[0].olderId, candidates[0].newerId].sort((a, b) => a - b), [primary.id, dup.id].sort((a, b) => a - b));
});

test("findDuplicateCandidates: two tasks that share nothing (no meeting/account/opportunity) are never even compared", () => {
  const a = baseTask({ subject: "Send sales progression playbook to Pavneet" });
  const b = baseTask({ subject: "Send sales progression playbook visuals to Pavneet" });
  assert.deepEqual(findDuplicateCandidates([a, b]), []);
});

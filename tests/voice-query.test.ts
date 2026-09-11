import assert from "node:assert/strict";
import test from "node:test";
import {
  applyActionSteps, briefingWorkingList, computeBriefing, computeMatches, describeBriefing,
  describeFilterPhrase, describeLastActive, describeTaskForWalk, resolveActTargets, resolveNext, speakableDate,
  type ActionStep, type ActTarget, type Filters, type StoredTask,
} from "../app/lib/voice-query";

let nextId = 1;
function baseTask(overrides: Partial<StoredTask> = {}): StoredTask {
  return {
    id: nextId++, subject: "Send updated pilot proposal", description: "Draft and send the revised proposal.",
    owner: "Rizan Flenner", collaborators: [], recipients: [], due: "", source: "Manual", topic: "", project: "",
    recurringMeeting: "", status: "Open", priority: "Low", created: "2026-09-08", createdBy: null, updates: [],
    closedAt: null, externalSource: null, externalId: null, accountId: null, accountName: null,
    opportunityId: null, opportunityName: null, meetingId: null, citationUser: null, citationQuote: null,
    ownerContactId: null, recipientContactIds: {}, mergedIntoTaskId: null,
    ...overrides,
  } as StoredTask;
}
const noFilters: Filters = {
  owner: null, mineOnly: false, myRole: null, project: null, topic: null, recurringMeeting: null,
  account: null, opportunity: null, source: null, priority: null, dueWithin: null, createdWithin: null,
  closedWithin: null, status: null, textContains: null, isNew: false, hasUnseenUpdate: false,
};

// ---- computeMatches ----

test("computeMatches: mineOnly matches owner only, never collaborator or recipient", () => {
  const tasks = [
    baseTask({ owner: "Rizan Flenner" }),
    baseTask({ owner: "Maya Chen", collaborators: ["Rizan Flenner"] }),
    baseTask({ owner: "Maya Chen", recipients: ["Rizan Flenner"] }),
  ];
  const result = computeMatches({ ...noFilters, mineOnly: true }, tasks, "Rizan Flenner", "2026-09-08", "2026-09-15");
  assert.equal(result.length, 1);
  assert.equal(result[0].owner, "Rizan Flenner");
});

test("computeMatches: myRole 'recipient' matches only the recipients field, not owner or collaborator", () => {
  const tasks = [
    baseTask({ owner: "Rizan Flenner" }),
    baseTask({ owner: "Maya Chen", collaborators: ["Rizan Flenner"] }),
    baseTask({ owner: "Maya Chen", recipients: ["Rizan Flenner"] }),
  ];
  const result = computeMatches({ ...noFilters, myRole: "recipient" }, tasks, "Rizan Flenner", "2026-09-08", "2026-09-15");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].recipients, ["Rizan Flenner"]);
});

test("computeMatches: myRole 'collaborator' matches only the collaborators field", () => {
  const tasks = [baseTask({ owner: "Maya Chen", collaborators: ["Rizan Flenner"] }), baseTask({ owner: "Maya Chen", recipients: ["Rizan Flenner"] })];
  const result = computeMatches({ ...noFilters, myRole: "collaborator" }, tasks, "Rizan Flenner", "2026-09-08", "2026-09-15");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].collaborators, ["Rizan Flenner"]);
});

test("computeMatches: account/opportunity/source filter on exact stored names", () => {
  const tasks = [
    baseTask({ accountName: "Acme Corp" }),
    baseTask({ opportunityName: "Q4 Renewal" }),
    baseTask({ source: "Sales AI" }),
    baseTask({}),
  ];
  assert.equal(computeMatches({ ...noFilters, account: "Acme Corp" }, tasks, "x", "2026-09-08", "2026-09-15").length, 1);
  assert.equal(computeMatches({ ...noFilters, opportunity: "Q4 Renewal" }, tasks, "x", "2026-09-08", "2026-09-15").length, 1);
  assert.equal(computeMatches({ ...noFilters, source: "Sales AI" }, tasks, "x", "2026-09-08", "2026-09-15").length, 1);
});

test("computeMatches: dueWithin overdue/week and closed/createdWithin today still work alongside the new fields", () => {
  const tasks = [
    baseTask({ due: "2026-09-01", status: "Open", created: "2026-08-20" }), // overdue
    baseTask({ due: "2026-09-10", status: "Open", created: "2026-08-21" }), // due this week
    baseTask({ due: "", created: "2026-09-08T10:00:00.000Z" }), // created today
  ];
  assert.equal(computeMatches({ ...noFilters, dueWithin: "overdue" }, tasks, "x", "2026-09-08", "2026-09-15").length, 1);
  assert.equal(computeMatches({ ...noFilters, dueWithin: "week" }, tasks, "x", "2026-09-08", "2026-09-15").length, 1);
  assert.equal(computeMatches({ ...noFilters, createdWithin: "today" }, tasks, "x", "2026-09-08", "2026-09-15").length, 1);
});

test("computeMatches: textContains matches subject OR description, case-insensitively", () => {
  const tasks = [
    baseTask({ subject: "Send sales playbook to Pavneet", description: "" }),
    baseTask({ subject: "Update security FAQ", description: "Mentions the PLAYBOOK approach." }),
    baseTask({ subject: "Unrelated task", description: "Nothing relevant here." }),
  ];
  const result = computeMatches({ ...noFilters, textContains: "playbook" }, tasks, "x", "2026-09-08", "2026-09-15");
  assert.equal(result.length, 2);
});

test("computeMatches: isNew filters to exactly the ids the caller marked as new, ignoring everything else about the task", () => {
  const tasks = [baseTask({ id: 10 }), baseTask({ id: 20 }), baseTask({ id: 30 })];
  const result = computeMatches({ ...noFilters, isNew: true }, tasks, "x", "2026-09-08", "2026-09-15", new Set([20]));
  assert.deepEqual(result.map(t => t.id), [20]);
});
test("computeMatches: isNew false (the default) never narrows by newness, even with no isNewTaskIds supplied", () => {
  const tasks = [baseTask({ id: 10 }), baseTask({ id: 20 })];
  assert.equal(computeMatches(noFilters, tasks, "x", "2026-09-08", "2026-09-15").length, 2);
});
test("computeMatches: hasUnseenUpdate filters to exactly the ids the caller marked as having an unseen update", () => {
  const tasks = [baseTask({ id: 10 }), baseTask({ id: 20 }), baseTask({ id: 30 })];
  const result = computeMatches({ ...noFilters, hasUnseenUpdate: true }, tasks, "x", "2026-09-08", "2026-09-15", new Set(), new Set([30]));
  assert.deepEqual(result.map(t => t.id), [30]);
});
test("computeMatches: isNew and hasUnseenUpdate combine (AND), each against its own id set", () => {
  const tasks = [baseTask({ id: 10 }), baseTask({ id: 20 }), baseTask({ id: 30 })];
  const result = computeMatches({ ...noFilters, isNew: true, hasUnseenUpdate: true }, tasks, "x", "2026-09-08", "2026-09-15", new Set([10, 20]), new Set([20, 30]));
  assert.deepEqual(result.map(t => t.id), [20]);
});

// ---- describeFilterPhrase ----

test("describeFilterPhrase: myRole produces a distinct phrase from mineOnly and from a plain owner filter", () => {
  assert.equal(describeFilterPhrase({ ...noFilters, mineOnly: true }), "tasks you own");
  assert.equal(describeFilterPhrase({ ...noFilters, myRole: "recipient" }), "tasks where you're the recipient");
  assert.equal(describeFilterPhrase({ ...noFilters, myRole: "collaborator" }), "tasks where you're a coworker");
  assert.equal(describeFilterPhrase({ ...noFilters, owner: "Maya Chen" }), "tasks for Maya Chen");
});

test("describeFilterPhrase: account/opportunity/source/textContains phrase in", () => {
  const phrase = describeFilterPhrase({ ...noFilters, account: "Acme Corp", opportunity: "Q4 Renewal", source: "Sales AI", textContains: "playbook" });
  assert.match(phrase, /for the Acme Corp account/);
  assert.match(phrase, /on the Q4 Renewal opportunity/);
  assert.match(phrase, /from Sales AI/);
  assert.match(phrase, /"playbook" in the subject or description/);
});
test("describeFilterPhrase: isNew reads as 'flagged new'", () => {
  assert.match(describeFilterPhrase({ ...noFilters, isNew: true }), /flagged new/);
});
test("describeFilterPhrase: hasUnseenUpdate reads as 'with a new status update'", () => {
  assert.match(describeFilterPhrase({ ...noFilters, hasUnseenUpdate: true }), /with a new status update/);
});

// ---- applyActionSteps ----

const step = (overrides: Partial<ActionStep>): ActionStep => ({
  type: null, dueDate: null, status: null, priority: null, owner: null,
  textValue: null, personName: null,
  ...overrides,
});

test("applyActionSteps: set_subject and set_description update the right fields and confirm", () => {
  const result = applyActionSteps(baseTask(), [step({ type: "set_subject", textValue: "New subject" }), step({ type: "set_description", textValue: "New description" })], "Rizan Flenner", []);
  assert.equal(result.error, null);
  assert.equal(result.updated.subject, "New subject");
  assert.equal(result.updated.description, "New description");
  assert.deepEqual(result.confirmations, ["Updated the subject.", "Updated the description."]);
});

test("applyActionSteps: set_subject is truncated to 140 characters, same limit manual create/edit already has", () => {
  const long = "x".repeat(200);
  const result = applyActionSteps(baseTask(), [step({ type: "set_subject", textValue: long })], "Rizan Flenner", []);
  assert.equal(result.updated.subject.length, 140);
});

test("applyActionSteps: set_project and set_topic update the right fields and confirm with the new value", () => {
  const result = applyActionSteps(baseTask(), [step({ type: "set_project", textValue: "Customer pilot" }), step({ type: "set_topic", textValue: "Playbook" })], "Rizan Flenner", []);
  assert.equal(result.error, null);
  assert.equal(result.updated.project, "Customer pilot");
  assert.equal(result.updated.topic, "Playbook");
  assert.deepEqual(result.confirmations, ["Set the project to Customer pilot.", "Set the topic to Playbook."]);
});

test("applyActionSteps: add_collaborator/add_recipient add once, never duplicate on a repeat command", () => {
  const task = baseTask({ collaborators: ["Maya Chen"] });
  const result = applyActionSteps(task, [step({ type: "add_collaborator", personName: "Maya Chen" }), step({ type: "add_recipient", personName: "Drew Foster" })], "Rizan Flenner", ["Maya Chen", "Drew Foster"]);
  assert.deepEqual(result.updated.collaborators, ["Maya Chen"]);
  assert.deepEqual(result.updated.recipients, ["Drew Foster"]);
});

test("applyActionSteps: add_collaborator resolves a partial/differently-cased name to the known exact spelling", () => {
  const result = applyActionSteps(baseTask(), [step({ type: "add_collaborator", personName: "maya chen" })], "Rizan Flenner", ["Maya Chen"]);
  assert.deepEqual(result.updated.collaborators, ["Maya Chen"]);
  assert.equal(result.confirmations[0], "Added Maya Chen as a coworker.");
});

test("applyActionSteps: remove_collaborator/remove_recipient take someone off, case-insensitively, no-op if absent", () => {
  const task = baseTask({ collaborators: ["Maya Chen"], recipients: ["Drew Foster"] });
  const result = applyActionSteps(task, [step({ type: "remove_collaborator", personName: "MAYA CHEN" }), step({ type: "remove_recipient", personName: "Nobody Here" })], "Rizan Flenner", []);
  assert.deepEqual(result.updated.collaborators, []);
  assert.deepEqual(result.updated.recipients, ["Drew Foster"]);
});

test("applyActionSteps: a missing required field on any new step type returns a clear error and stops there", () => {
  assert.equal(applyActionSteps(baseTask(), [step({ type: "set_subject", textValue: "" })], "x", []).error, "I didn't catch the new subject.");
  assert.equal(applyActionSteps(baseTask(), [step({ type: "set_description", textValue: null })], "x", []).error, "I didn't catch the new description.");
  assert.equal(applyActionSteps(baseTask(), [step({ type: "set_project", textValue: "" })], "x", []).error, "I didn't catch the new project.");
  assert.equal(applyActionSteps(baseTask(), [step({ type: "set_topic", textValue: null })], "x", []).error, "I didn't catch the new topic.");
  assert.equal(applyActionSteps(baseTask(), [step({ type: "add_collaborator", personName: null })], "x", []).error, "I didn't catch who to add as a coworker.");
  assert.equal(applyActionSteps(baseTask(), [step({ type: "add_recipient", personName: "" })], "x", []).error, "I didn't catch who to add as a recipient.");
});

test("applyActionSteps: still applies every pre-existing action type exactly as before (due/status/priority/owner/update)", () => {
  const result = applyActionSteps(baseTask({ status: "Open" }), [
    step({ type: "set_due", dueDate: "2026-09-12" }),
    step({ type: "set_status", status: "Closed" }),
    step({ type: "set_priority", priority: "High" }),
    step({ type: "set_owner", owner: "Maya Chen" }),
    step({ type: "add_update", textValue: "Redlines are in." }),
  ], "Rizan Flenner", ["Maya Chen"]);
  assert.equal(result.error, null);
  assert.equal(result.updated.due, "2026-09-12");
  assert.equal(result.updated.status, "Closed");
  assert.equal(result.explicitStatus, "Closed");
  assert.equal(result.updated.priority, "High");
  assert.equal(result.updated.owner, "Maya Chen");
  assert.equal(result.updatesGrew, true);
  assert.equal(result.updated.updates.length, 1);
});

test("applyActionSteps: clearing the due date (dueDate: null) is a valid instruction, not an error", () => {
  const result = applyActionSteps(baseTask({ due: "2026-09-12" }), [step({ type: "set_due", dueDate: null })], "x", []);
  assert.equal(result.error, null);
  assert.equal(result.updated.due, "");
  assert.equal(result.confirmations[0], "Cleared the due date.");
});

// ---- resolveActTargets ----

const noTarget: ActTarget = { taskId: null, applyToWorkingList: false };

test("resolveActTargets: defaults to the current task when neither taskId nor applyToWorkingList is set", () => {
  const current = baseTask({ id: 175 });
  const result = resolveActTargets(noTarget, current, [], [current]);
  assert.deepEqual(result.map(t => t.id), [175]);
});

test("resolveActTargets: no current task and no target set resolves to nothing, not an error by itself", () => {
  assert.deepEqual(resolveActTargets(noTarget, null, [], []), []);
});

test("resolveActTargets: 'task 175' — an explicit taskId resolves that task even though it's not the one open", () => {
  const current = baseTask({ id: 1 });
  const named = baseTask({ id: 175 });
  const result = resolveActTargets({ taskId: 175, applyToWorkingList: false }, current, [], [current, named]);
  assert.deepEqual(result.map(t => t.id), [175]);
});

test("resolveActTargets: an explicit taskId that isn't visible resolves to nothing", () => {
  const current = baseTask({ id: 1 });
  assert.deepEqual(resolveActTargets({ taskId: 999, applyToWorkingList: false }, current, [], [current]), []);
});

test("resolveActTargets: applyToWorkingList resolves every visible task in the working list, in that order, de-duplicated", () => {
  const a = baseTask({ id: 10 }), b = baseTask({ id: 20 }), c = baseTask({ id: 30 });
  const result = resolveActTargets({ taskId: null, applyToWorkingList: true }, null, [10, 20, 10, 30], [a, b, c]);
  assert.deepEqual(result.map(t => t.id), [10, 20, 30]);
});

test("resolveActTargets: applyToWorkingList skips a listed id that's no longer visible instead of erroring", () => {
  const a = baseTask({ id: 10 }), c = baseTask({ id: 30 }); // id 20 deleted/hidden
  const result = resolveActTargets({ taskId: null, applyToWorkingList: true }, null, [10, 20, 30], [a, c]);
  assert.deepEqual(result.map(t => t.id), [10, 30]);
});

test("resolveActTargets: applyToWorkingList takes priority over an explicit taskId if both were somehow set", () => {
  const a = baseTask({ id: 10 });
  const result = resolveActTargets({ taskId: 999, applyToWorkingList: true }, null, [10], [a]);
  assert.deepEqual(result.map(t => t.id), [10]);
});

// ---- briefing ----

test("computeBriefing: buckets due-today/overdue as owner, and due-today as recipient (never owner) separately", () => {
  const tasks = [
    baseTask({ owner: "Rizan Flenner", due: "2026-09-08", status: "Open" }), // due today, owner
    baseTask({ owner: "Rizan Flenner", due: "2026-08-01", status: "Open" }), // overdue, owner
    baseTask({ owner: "Maya Chen", recipients: ["Rizan Flenner"], due: "2026-09-08", status: "Open" }), // due today, recipient
    baseTask({ owner: "Rizan Flenner", due: "2026-09-08", status: "Closed" }), // closed — excluded everywhere
  ];
  const counts = computeBriefing(tasks, "Rizan Flenner", "2026-09-08");
  assert.equal(counts.dueToday.length, 1);
  assert.equal(counts.overdue.length, 1);
  assert.equal(counts.dueTodayAsRecipient.length, 1);
});

test("computeBriefing: a task the actor both owns and is a recipient on counts only as owner, never double-bucketed", () => {
  const tasks = [baseTask({ owner: "Rizan Flenner", recipients: ["Rizan Flenner"], due: "2026-09-08", status: "Open" })];
  const counts = computeBriefing(tasks, "Rizan Flenner", "2026-09-08");
  assert.equal(counts.dueToday.length, 1);
  assert.equal(counts.dueTodayAsRecipient.length, 0);
});

test("describeBriefing: an all-clear day gets its own distinct message, not '0 due today'", () => {
  const counts = computeBriefing([], "Rizan Flenner", "2026-09-08");
  assert.match(describeBriefing(counts), /all clear/);
});

test("describeBriefing: mentions overdue, due today, and recipient counts together when all three are non-zero", () => {
  const tasks = [
    baseTask({ owner: "R", due: "2026-09-08", status: "Open" }),
    baseTask({ owner: "R", due: "2026-08-01", status: "Open" }),
    baseTask({ owner: "M", recipients: ["R"], due: "2026-09-08", status: "Open" }),
  ];
  const spoken = describeBriefing(computeBriefing(tasks, "R", "2026-09-08"));
  assert.match(spoken, /1 overdue/);
  assert.match(spoken, /1 due today/);
  assert.match(spoken, /where you're the recipient/);
});

test("describeBriefing: ends with the walk-through offer whenever anything's flagged", () => {
  const tasks = [baseTask({ owner: "R", due: "2026-09-08", status: "Open" })];
  const spoken = describeBriefing(computeBriefing(tasks, "R", "2026-09-08"));
  assert.match(spoken, /Want me to walk you through them one by one\?$/);
});

test("describeBriefing: an all-clear day does NOT offer a walk-through — there's nothing to walk", () => {
  const spoken = describeBriefing(computeBriefing([], "Rizan Flenner", "2026-09-08"));
  assert.doesNotMatch(spoken, /walk you through/);
});

test("briefingWorkingList: orders overdue first, then due-today, then recipient, de-duplicated", () => {
  const overdueTask = baseTask({ id: 100 });
  const dueTodayTask = baseTask({ id: 200 });
  const recipientTask = baseTask({ id: 300 });
  const ids = briefingWorkingList({ overdue: [overdueTask], dueToday: [dueTodayTask], dueTodayAsRecipient: [recipientTask] });
  assert.deepEqual(ids, [100, 200, 300]);
});

// ---- pre-existing helpers, still exercised after the move to lib/voice-query.ts ----

test("speakableDate: formats a plain YYYY-MM-DD as a natural spoken phrase", () => {
  assert.equal(speakableDate("2026-09-07"), "Monday, September 7th");
});
test("speakableDate: null/empty/malformed all return null rather than throwing", () => {
  assert.equal(speakableDate(null), null);
  assert.equal(speakableDate(""), null);
  assert.equal(speakableDate("not-a-date"), null);
});

test("describeTaskForWalk: reads subject, description, due date, then prompts for what to do next", () => {
  const spoken = describeTaskForWalk(baseTask({ subject: "Send proposal", description: "Draft it", due: "2026-09-12" }));
  assert.match(spoken, /^Send proposal\./);
  assert.match(spoken, /Draft it\./);
  assert.match(spoken, /Due Saturday, September 12th\./);
  assert.match(spoken, /What do you want me to do\?$/);
});
test("describeTaskForWalk: no due date reads as 'No due date.' rather than a blank", () => {
  assert.match(describeTaskForWalk(baseTask({ due: "" })), /No due date\./);
});
test("describeTaskForWalk: reads status and, when there's a most-recent status update, its text — requested 2026-09-08 so a walk-through covers Subject, status, due date, and last update", () => {
  const withUpdate = describeTaskForWalk(baseTask({
    status: "In progress",
    updates: [{ text: "Waiting on legal.", at: "2026-09-01" }, { text: "Draft sent for review.", at: "2026-09-05" }],
  }));
  assert.match(withUpdate, /Status: In progress\./);
  // The most recent update only — not the whole history.
  assert.match(withUpdate, /Last update: Draft sent for review\./);
  assert.doesNotMatch(withUpdate, /Waiting on legal/);
});
test("describeTaskForWalk: omits the 'Last update' line entirely when nothing's been posted yet", () => {
  assert.doesNotMatch(describeTaskForWalk(baseTask({ updates: [] })), /Last update/);
});

test("resolveNext: returns the next visible id after currentTaskId, skipping ids no longer visible", () => {
  const t1 = baseTask({ id: 1 }), t3 = baseTask({ id: 3 });
  const found = resolveNext(1, [1, 2, 3], [t1, t3]); // id 2 was deleted/hidden
  assert.equal(found?.id, 3);
});
test("resolveNext: past the end of the list returns null", () => {
  assert.equal(resolveNext(3, [1, 2, 3], [baseTask({ id: 1 }), baseTask({ id: 2 }), baseTask({ id: 3 })]), null);
});

test("describeLastActive: null means never signed in; recent times read as relative phrases", () => {
  assert.equal(describeLastActive(null), "never signed in");
  assert.equal(describeLastActive(new Date(Date.now() - 10_000)), "active just now");
  assert.equal(describeLastActive(new Date(Date.now() - 3 * 60 * 60 * 1000)), "about 3 hours ago");
});

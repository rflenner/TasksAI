import assert from "node:assert/strict";
import test from "node:test";
import { accessSummary, renderAddedToPlan, renderInvitation } from "../app/lib/close-plan-emails";
import { newInternalMembers, reminderDue, waitingTasks } from "../app/lib/close-plan-invitations";
import { DEFAULT_RULES } from "../app/lib/close-plan-notify-rules";

test("the invitation email has the link, what the person can do, their open tasks and an unsubscribe link, and escapes names", () => {
  const m = renderInvitation({ firstName: "Gary", fromName: "Rizan <script>", planTitle: "Cluepoints & iSEEit", url: "https://x.test/p/abc", unsubscribeUrl: "https://x.test/unsubscribe/t", can: accessSummary({ level: "own", create: true }), tasks: [{ title: "Sign off scope", due: "2026-10-30" }, { title: "Send logos", overdue: true }] });
  assert.match(m.subject, /invited you to the Cluepoints & iSEEit plan/);
  assert.ok(m.html.includes("https://x.test/p/abc") && m.html.includes("https://x.test/unsubscribe/t"));
  assert.ok(!m.html.includes("<script>"), "names are escaped");
  assert.match(m.html, /Sign off scope/);
  assert.match(m.html, /Overdue/);
  assert.match(m.html, /iseeit-logo\.png" width="44"[^>]*alt="iSEEit"/);
  assert.match(m.html, /Mutual Closeplan/);
  assert.match(m.text, /Open the plan: https:\/\/x\.test\/p\/abc/);
  assert.match(m.text, /Stop these emails: https:\/\/x\.test\/unsubscribe\/t/);
  assert.ok(m.text.includes("Close and edit the tasks you own"));
  const r = renderInvitation({ firstName: "Gary", fromName: "Rizan", planTitle: "P", url: "u", unsubscribeUrl: "x", can: [], tasks: [], reminder: true });
  assert.match(r.subject, /^Reminder/);
  assert.match(r.text, /haven't opened it yet/);
});

test("the added-to-plan email names who added them and the plan", () => {
  const m = renderAddedToPlan({ firstName: "Drew", byName: "Rizan", planTitle: "Cluepoints", role: "Solutions engineer", url: "https://x.test/close-plans", unsubscribeUrl: "https://x.test/unsubscribe/t" });
  assert.match(m.subject, /Rizan added you to the Cluepoints close plan/);
  assert.match(m.text, /as Solutions engineer/);
});

test("the waiting list holds a contact's open shared tasks, soonest first, never internal ones", () => {
  const data = { tasks: [
    { id: "a", title: "Later", owner: "c1", due: "2026-12-01", status: "Open", shared: true },
    { id: "b", title: "Soon", owner: "x", coworkers: ["c1"], due: "2026-10-20", status: "In progress", shared: true },
    { id: "c", title: "Internal", owner: "c1", due: "2026-10-19", status: "Open", shared: false },
    { id: "d", title: "Done", owner: "c1", due: "2026-10-18", status: "Closed", shared: true },
    { id: "e", title: "Not mine", owner: "x", status: "Open", shared: true },
  ] };
  assert.deepEqual(waitingTasks(data, "c1", "2026-10-25").map(t => [t.title, t.overdue]), [["Soon", true], ["Later", false]]);
});

test("reminders: only unopened links, after the days, at most the limit, and never above the weekly cap", () => {
  const rules = { ...DEFAULT_RULES.invitation, reminderAfterDays: 3, maxReminders: 2 };
  const now = new Date("2026-10-20T08:00:00Z"), days = (n: number) => new Date(now.getTime() - n * 86400000);
  const base = { rules, scheduledLastWeek: 0, cap: 1, now };
  assert.equal(reminderDue({ ...base, lastSentAt: days(4), reminders: 0, opened: false }), true);
  assert.equal(reminderDue({ ...base, lastSentAt: days(2), reminders: 0, opened: false }), false, "too soon");
  assert.equal(reminderDue({ ...base, lastSentAt: days(9), reminders: 0, opened: true }), false, "already opened");
  assert.equal(reminderDue({ ...base, lastSentAt: days(9), reminders: 2, opened: false }), false, "limit reached");
  assert.equal(reminderDue({ ...base, lastSentAt: days(9), reminders: 0, opened: false, scheduledLastWeek: 1 }), false, "weekly cap");
  assert.equal(reminderDue({ ...base, rules: { ...rules, email: false }, lastSentAt: days(9), reminders: 0, opened: false }), false, "switched off");
  assert.equal(reminderDue({ ...base, rules: { ...rules, reminderAfterDays: 0 }, lastSentAt: days(9), reminders: 0, opened: false }), false, "no reminder configured");
});

test("only new iSEEit people, not the person who added them nor Salesforce-pulled ones, hear about being added", () => {
  const before = { people: [{ id: "a", side: "seller", email: "Rizan@iseeit.com" }, { id: "k", side: "buyer", email: "k@cust.com" }] };
  const after = { people: [...before.people,
    { id: "b", side: "seller", name: "Drew Klein", email: "drew@iseeit.com", role: "SE" },
    { id: "c", side: "buyer", name: "New Customer", email: "n@cust.com" },
    { id: "d", side: "seller", name: "From SFDC", email: "s@iseeit.com", sfdcUserId: "005000000000001AAA" },
    { id: "e", side: "seller", name: "Quiet", email: "q@iseeit.com", noEmail: true }] };
  assert.deepEqual(newInternalMembers(before, after, "rizan@iseeit.com").map(m => [m.id, m.noEmail]), [["b", false], ["e", true]]);
  assert.deepEqual(newInternalMembers(before, before, "rizan@iseeit.com"), []);
});

import { assignmentChanges } from "../app/lib/close-plan-assignments";
import { renderAssigned } from "../app/lib/close-plan-emails";

test("assignment changes: a new owner or coworker on an open task, and every assignee of a new task", () => {
  const before = { tasks: [{ id: "t1", title: "A", owner: "p1", coworkers: ["p2"], status: "Open" }, { id: "t2", title: "B", owner: "p1", status: "Open" }, { id: "t3", title: "C", owner: "p1", status: "Open" }] };
  const after = { tasks: [
    { id: "t1", title: "A", owner: "p3", coworkers: ["p2", "p4"], status: "Open", due: "2026-10-30", desc: "Do it" },
    { id: "t2", title: "B", owner: "p1", status: "Open" },
    { id: "t3", title: "C", owner: "p2", status: "Closed" },
    { id: "t4", title: "New", owner: "p3", coworkers: ["p1"], status: "Open", due: "2026-10-01" },
  ] };
  const got = Object.fromEntries(assignmentChanges(before, after, "2026-10-19").map(c => [c.personId, c.tasks.map(t => `${t.taskId}:${t.role}${t.overdue ? ":overdue" : ""}`)]));
  assert.deepEqual(got, { p3: ["t1:Owner", "t4:Owner:overdue"], p4: ["t1:Coworker"], p1: ["t4:Coworker:overdue"] });
  assert.deepEqual(assignmentChanges(before, before), []);
  assert.deepEqual(assignmentChanges(before, after, "2026-10-19", true).map(c => c.personId).sort(), ["p3", "p4"], "tasks that are new are skipped when asked");
});

test("the assigned-task email names who assigned what, in one email for several tasks", () => {
  const one = renderAssigned({ firstName: "Drew", byName: "Rizan", planTitle: "Cluepoints", tasks: [{ title: "Sign off scope", role: "Owner", due: "2026-10-30" }], url: "https://x.test/close-plans", unsubscribeUrl: "https://x.test/unsubscribe/t" });
  assert.match(one.subject, /Rizan assigned you “Sign off scope” in Cluepoints/);
  assert.match(one.html, /Sign off scope/);
  assert.match(one.html, /iseeit-logo\.png/);
  assert.match(one.text, /as owner of “Sign off scope”/);
  const many = renderAssigned({ firstName: "Drew", byName: "Rizan", planTitle: "Cluepoints", tasks: [{ title: "A", role: "Owner" }, { title: "B", role: "Coworker", overdue: true }], url: "u", unsubscribeUrl: "x" });
  assert.match(many.subject, /assigned you 2 tasks in Cluepoints/);
  assert.match(many.text, /- B \(Coworker, overdue\)/);
});

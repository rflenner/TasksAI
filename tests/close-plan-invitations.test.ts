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
  assert.match(m.html, /overdue/);
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

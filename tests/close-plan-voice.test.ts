import assert from "node:assert/strict";
import test from "node:test";
import { calendar, checkProposal, completeDraft, confirmQuestion, describeActions, grounded, describeTask, listLabel, listMatches, type NewTask, planContext, type Proposal, sanitizeDraft, speakable, type VoiceAction, viewerId } from "../app/lib/close-plan-voice";

// Fictional data only — this repository is public.
const plan = () => ({
  id: "pl1", title: "Rollout", account: "Meridian Biotech",
  planOwners: { seller: "s1", buyer: "b1" },
  phases: [{ id: "p1", name: "Align", start: "2026-10-01", end: "2026-10-09" }, { id: "p2", name: "Validate", start: "2026-10-12", end: "2026-10-30" }],
  people: [
    { id: "s1", side: "seller", name: "Sam Seller", email: "Sam@iseeit.example" },
    { id: "b1", side: "buyer", name: "Olivia Grant", email: "olivia@meridian-bio.example" },
  ],
  tasks: [
    { id: "t1", phase: "p1", parent: null, title: "Kickoff", owner: "b1", due: "2026-10-01", status: "Open", shared: true, updates: [] },
    { id: "t2", phase: "p1", parent: null, title: "Pricing", owner: "s1", due: "2026-10-20", status: "Open", shared: false, updates: [] },
    { id: "t3", phase: "p2", parent: null, title: "Security review", owner: "s1", due: "2026-10-20", status: "In progress", shared: true, recipients: ["b1"], updates: [{ text: "Sent" }] },
    { id: "t4", phase: "p2", parent: null, title: "Signature", owner: "b1", due: "2026-10-30", status: "Open", shared: true, milestone: true, key: "sign", updates: [] },
    { id: "t5", phase: "p2", parent: "t3", title: "SOC 2", owner: "s1", due: null, status: "Closed", shared: true, updates: [] },
  ],
});
const none: Proposal = { mode: "act", answer: "", taskId: null, filter: null, personId: null, phaseId: null, actions: [], newTask: null };

test("speakable dates and the viewer by email", () => {
  assert.equal(speakable("2026-10-09", "2026-10-02"), "Friday, October 9th");
  assert.equal(speakable("2027-01-03", "2026-10-02"), "Sunday, January 3rd, 2027");
  assert.equal(viewerId(plan(), "sam@iseeit.example"), "s1");
  assert.equal(viewerId(plan(), "olivia@meridian-bio.example"), null);
});

test("planContext flags overdue, internal and key dates; the customer audience never sees internal tasks", () => {
  const c = planContext(plan(), "s1", "2026-10-02");
  const t1 = c.tasks.find(t => t.id === "t1")!;
  assert.equal(t1.overdue, true);
  assert.equal(t1.ownerSide, "customer");
  assert.equal(c.tasks.find(t => t.id === "t2")!.internal, true);
  assert.equal(c.tasks.find(t => t.id === "t4")!.keyDate, "signature");
  assert.equal(c.phases[0].current, true);
  assert.equal(planContext(plan(), null, "2026-10-02", "buyer").tasks.some(t => t.id === "t2"), false);
});

test("listMatches follows the page's filters", () => {
  const p = plan(), today = "2026-10-02";
  assert.deepEqual(listMatches(p, "buyer", "s1", today), ["t1", "t4"]);
  assert.deepEqual(listMatches(p, "seller", "s1", today), ["t2", "t3"]);
  assert.deepEqual(listMatches(p, "overdue", "s1", today), ["t1"]);
  assert.deepEqual(listMatches(p, "internal", "s1", today), ["t2"]);
  assert.deepEqual(listMatches(p, "mine", "s1", today), ["t2", "t3"]);
  assert.deepEqual(listMatches(p, "person", "s1", today, "b1"), ["t1", "t3", "t4"]);
  assert.deepEqual(listMatches(p, "all", "s1", today, null, "p2"), ["t3", "t4", "t5"]);
  assert.equal(listLabel(p, "buyer", null, "p2"), "open tasks waiting on Meridian Biotech in Validate");
});

test("describeTask reads title, details, owner, status, due and the last update", () => {
  const spoken = describeTask(plan(), "t3", "2026-10-02");
  assert.match(spoken, /^Security review\. Owner: Sam Seller\. Status: In progress\. Due Tuesday, October 20th\. Last update: Sent$/);
  assert.match(describeTask(plan(), "t2", "2026-10-02"), /It's internal\.$/);
});

test("checkProposal keeps only real tasks, people, statuses and dates", () => {
  const ok = checkProposal(plan(), { ...none, taskId: "t3", actions: [
    { type: "set_status", status: "Closed", text: null, date: null, personId: null },
    { type: "set_owner", status: null, text: null, date: null, personId: "nobody" },
    { type: "set_due", status: null, text: null, date: "next week", personId: null },
    { type: "post_update", status: null, text: "  Done  ", date: null, personId: null },
  ] }, null);
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.deepEqual(ok.actions.map(a => a.type), ["set_status", "post_update"]); assert.equal(ok.actions[1].text, "Done"); }
  const focus = checkProposal(plan(), { ...none, actions: [{ type: "set_status", status: "In progress", text: null, date: null, personId: null }] }, "t1");
  assert.equal(focus.ok && focus.taskId, "t1");
  assert.equal(checkProposal(plan(), { ...none, taskId: "t99", actions: [{ type: "set_status", status: "Closed", text: null, date: null, personId: null }] }, "t1").ok, false);
  assert.equal(checkProposal(plan(), { ...none, taskId: "t1", actions: [] }, null).ok, false);
});

const nt = (o: Partial<NewTask> = {}): NewTask => ({ title: "Send report", phaseId: null, parentId: null, ownerId: null, due: null, description: null, internal: false, done: false, ...o });
const ask = (r: ReturnType<typeof completeDraft>) => { assert.equal(r.kind, "ask"); return r.kind === "ask" ? r : (undefined as never); };

test("a new task: the phase is checked first, offering the current one", () => {
  const r = ask(completeDraft(plan(), null, nt(), "add a task send report", "2026-10-02"));
  assert.match(r.question, /^Which phase should "Send report" go in\? You're in Align right now\.$/);
  assert.equal(r.draft.askedPhase, true);
});

test("a new task with a named phase asks once for the owner, due date and description that are missing", () => {
  const first = ask(completeDraft(plan(), null, nt({ phaseId: "p2" }), "add a task to Validate send report", "2026-10-02"));
  assert.equal(first.question, `For "Send report" in Validate: Who should own it, when it's due and anything for the description? Or say skip.`);
  // They answer with owner and date only: not asked again, created with the description empty.
  const done = completeDraft(plan(), first.draft, nt({ title: "", ownerId: "b1", due: "2026-10-09" }), "Olivia, due next Friday", "2026-10-02");
  assert.equal(done.kind, "create");
  if (done.kind === "create") assert.deepEqual(done.newTask, { title: "Send report", phaseId: "p2", parentId: null, ownerId: "b1", due: "2026-10-09", description: null, internal: false });
});

test("a new task is created straight away when everything was said", () => {
  const r = completeDraft(plan(), null, nt({ phaseId: "p1", ownerId: "s1", due: "2026-10-09", description: "the report for the board" }), "add send report to align, owner Sam, due Friday, the report for the board", "2026-10-02");
  assert.equal(r.kind, "create");
});

test("skip ends the questions: current phase, no owner or date (the page fills in defaults)", () => {
  const first = ask(completeDraft(plan(), null, nt(), "add a task send report", "2026-10-02"));
  const r = completeDraft(plan(), first.draft, nt({ title: "", done: true }), "skip", "2026-10-02");
  assert.equal(r.kind, "create");
  if (r.kind === "create") { assert.equal(r.newTask.phaseId, "p1"); assert.equal(r.newTask.ownerId, null); assert.equal(r.newTask.due, null); }
});

test("a subtask takes its parent's phase and is not asked for a description; unknown people and dates are dropped", () => {
  const r = ask(completeDraft(plan(), null, nt({ title: "Book the room", phaseId: "p1", parentId: "t3", ownerId: "zz", due: "next week" }), "add a subtask book the room", "2026-10-02"));
  assert.match(r.question, /^For "Book the room" in Validate: Who should own it and when it's due\? Or say skip\.$/);
  assert.equal(r.draft.phaseId, "p2");
  assert.equal(completeDraft(plan(), null, nt({ title: "Something else entirely" }), "add a task", "2026-10-02").kind, "error");
  assert.equal(completeDraft(plan(), null, nt({ parentId: "nope" }), "add a subtask send report", "2026-10-02").kind, "error");
});

test("a draft sent back by the page is cleaned: unknown ids drop out", () => {
  const d = sanitizeDraft(plan(), { title: " Send report ", phaseId: "nope", ownerId: "s1", parentId: "zzz", due: "soon", description: "", internal: true, askedPhase: true, askedDetails: "yes" });
  assert.deepEqual(d, { title: "Send report", phaseId: null, ownerId: "s1", parentId: null, due: null, description: null, internal: true, askedPhase: true, askedDetails: false });
  assert.equal(sanitizeDraft(plan(), { title: "  " }), null);
});

test("every task field has an action: phase, internal/shared, milestone, remove people, subtask checkboxes", () => {
  const a = (o: Partial<VoiceAction>): VoiceAction => ({ type: "set_status", status: null, text: null, date: null, personId: null, phaseId: null, flag: null, ...o });
  const ok = checkProposal(plan(), { ...none, taskId: "t3", actions: [
    a({ type: "set_phase", phaseId: "p1" }), a({ type: "set_shared", flag: false }), a({ type: "set_milestone", flag: true }),
    a({ type: "remove_coworker", personId: "b1" }), a({ type: "remove_requester", personId: "zz" }), a({ type: "set_shared", flag: null }), a({ type: "set_phase", phaseId: "nope" }),
  ] }, null);
  assert.equal(ok.ok && ok.actions.map(x => x.type).join(), "set_phase,set_shared,set_milestone,remove_coworker");
  const sub = checkProposal(plan(), { ...none, taskId: "t5", actions: [a({ type: "set_phase", phaseId: "p1" })] }, null);
  assert.equal(sub.ok, false);
  assert.match(!sub.ok ? sub.reason : "", /stays in the phase of its main task/);
  const tick = [a({ type: "set_status", status: "Closed" })];
  assert.equal(confirmQuestion(plan(), "t5", tick, "2026-10-02"), null);
  assert.equal(describeActions(plan(), "t5", tick, "2026-10-02"), `Ticked off the subtask "SOC 2".`);
  assert.equal(describeActions(plan(), "t5", [a({ type: "set_status", status: "Open" })], "2026-10-02"), `Unticked the subtask "SOC 2".`);
  assert.equal(describeActions(plan(), "t3", [a({ type: "set_phase", phaseId: "p1" }), a({ type: "set_shared", flag: false })], "2026-10-02"), `Moved "Security review" to Align. "Security review" is now internal.`);
});

test("closing a task and moving a milestone ask for a yes; other changes don't", () => {
  const close = [{ type: "set_status" as const, status: "Closed", text: null, date: null, personId: null }];
  const move = [{ type: "set_due" as const, status: null, text: null, date: "2026-11-06", personId: null }];
  assert.match(confirmQuestion(plan(), "t1", close, "2026-10-02")!, /^Close "Kickoff"\? Say yes/);
  assert.match(confirmQuestion(plan(), "t4", move, "2026-10-02")!, /^Move the milestone "Signature" to Friday, November 6th\?/);
  assert.equal(confirmQuestion(plan(), "t1", move, "2026-10-02"), null);
});

test("text written into a task must come from what was said", () => {
  assert.equal(grounded("Marcus confirmed he will send the questionnaire on Monday", "post an update: Marcus confirmed he will send the questionnaire on Monday"), true);
  assert.equal(grounded("Marked complete per your request.", "mark it done"), false);
  const r = checkProposal(plan(), { ...none, taskId: "t3", actions: [
    { type: "set_status", status: "Closed", text: null, date: null, personId: null },
    { type: "post_update", status: null, text: "Marked complete per your request.", date: null, personId: null },
  ] }, null, "mark it done");
  assert.equal(r.ok && r.actions.map(a => a.type).join(), "set_status");
  assert.equal(completeDraft(plan(), null, { title: "Prepare onboarding deck", phaseId: "p1", parentId: null, ownerId: null, due: null, internal: false }, "add a task", "2026-10-02").kind, "error");
});

test("the calendar names each date's weekday", () => {
  const c = calendar("2026-10-02", 8);
  assert.match(c, /^2026-10-02 Friday, 2026-10-03 Saturday/);
  assert.match(c, /2026-10-09 Friday$/);
});

test("who is waiting on whom comes from the sentence, not the AI", async () => {
  const { waitingSide, addressedToSomeoneElse } = await import("../app/lib/close-plan-voice");
  const names = ["Meridian Biotech", "Olivia Grant"];
  assert.equal(waitingSide("What is Meridian Biotech waiting on?", names), "seller");
  assert.equal(waitingSide("what are they waiting for", names), "seller");
  assert.equal(waitingSide("What are we waiting on from them?", names), "buyer");
  assert.equal(waitingSide("what are we waiting on from Meridian Biotech", names), "buyer");
  assert.equal(waitingSide("anything waiting on the customer", names), "buyer");
  assert.equal(waitingSide("where do we stand", names), null);
  const people = [{ name: "Drew Klein" }, { name: "Olivia Grant" }];
  assert.equal(addressedToSomeoneElse("Drew, can you check that for me?", people), true);
  assert.equal(addressedToSomeoneElse("Assign it to Drew, please", people), false);
  assert.equal(addressedToSomeoneElse("Okay, mark it done", people), false);
});

test("deleting by voice always asks first and names the subtasks", () => {
  const del = [{ type: "delete_task" as const, status: null, text: null, date: null, personId: null }];
  const r = checkProposal(plan(), { ...none, taskId: "t3", actions: del }, null, "delete the security review");
  assert.equal(r.ok, true);
  assert.equal(confirmQuestion(plan(), "t3", del, "2026-10-06"), `Delete "Security review" and its 1 subtask? This can't be undone. Say yes to confirm.`);
});

test("the AI can't fill in what nobody said: phase, owner and parent task need the person's own words", () => {
  const guessed = nt({ title: "Send report", phaseId: "p2", parentId: "t3", ownerId: "b1" });
  const r = ask(completeDraft(plan(), null, guessed, "add a task send report", "2026-10-02", "s1"));
  assert.match(r.question, /^Which phase should "Send report" go in\?/);
  assert.equal(r.draft.parentId, null);
  assert.equal(r.draft.ownerId, null);
  // Named in their words: accepted. "Me" means the viewer.
  const said = completeDraft(plan(), null, nt({ phaseId: "p2", ownerId: "s1", due: "2026-10-09", description: "for the board" }), "add send report to Validate, owner me, due Friday, for the board", "2026-10-02", "s1");
  assert.equal(said.kind, "create");
  if (said.kind === "create") { assert.equal(said.newTask.phaseId, "p2"); assert.equal(said.newTask.ownerId, "s1"); }
  const sub = ask(completeDraft(plan(), null, nt({ title: "Book room", parentId: "t3" }), "add a subtask book room", "2026-10-02", "s1"));
  assert.equal(sub.draft.parentId, "t3");
});

test("a due date the AI made up is dropped; one that was said is kept", () => {
  const made = ask(completeDraft(plan(), null, nt({ phaseId: "p2", ownerId: "s1", due: "2026-10-28", description: "for the board" }), "add send report to Validate, owner me, for the board", "2026-10-02", "s1"));
  assert.match(made.question, /when it's due/i);
  const said = completeDraft(plan(), null, nt({ phaseId: "p2", ownerId: "s1", due: "2026-10-09", description: "for the board" }), "add send report to Validate, owner me, due next Friday, for the board", "2026-10-02", "s1");
  assert.equal(said.kind, "create");
});

import { checkPhaseEdit } from "../app/lib/close-plan-voice";
test("checkPhaseEdit: rename, dates, add and delete a phase", () => {
  const data = { phases: [{ id: "p1", name: "Discovery", start: "2026-10-01", end: "2026-10-31" }, { id: "p2", name: "Validate", start: "2026-11-01", end: "2026-11-30" }], tasks: [{ id: "t1", phase: "p2" }, { id: "t2", phase: "p2" }] };
  const edit = (phaseId: string | null, e: Partial<{ add: boolean; remove: boolean; name: string; goal: string; start: string; end: string; moveTo: string }>, say: string) =>
    checkPhaseEdit(data, phaseId, { add: false, remove: false, name: null, goal: null, start: null, end: null, moveTo: null, ...e }, say, "2026-10-19");
  const rename = edit("p2", { name: "Proof of value" }, "rename Validate to Proof of value");
  assert.ok(rename.ok && rename.edit.name === "Proof of value" && /Renamed "Validate"/.test(rename.said));
  assert.equal(edit("p2", { name: "Made up" }, "rename Validate").ok, false);
  const end = edit("p2", { end: "2026-12-15" }, "move the end of Validate to December 15th");
  assert.ok(end.ok && end.edit.end === "2026-12-15" && end.edit.start === null);
  const bad = edit("p2", { end: "2026-10-15" }, "end Validate on October 15th");
  assert.equal(bad.ok, false);
  assert.equal(edit("zz", { end: "2026-12-15" }, "x").ok, false);
  const add = edit(null, { add: true, name: "Rollout", start: "2026-12-01", end: "2026-12-31" }, "add a phase Rollout from December 1st to December 31st");
  assert.ok(add.ok && add.edit.add && add.edit.phaseId === null);
  assert.equal(edit(null, { add: true, name: "Rollout" }, "add a phase Rollout").ok, false);
  const del = edit("p2", { remove: true }, "delete the phase Validate");
  assert.ok(del.ok && del.question && /Its 2 tasks move to Discovery/.test(del.question) && del.edit.moveTo === "p1");
});

import { briefing, newsDays, whatsNew } from "../app/lib/close-plan-voice";
test("briefing and whatsNew: counted by code, in plain sentences", () => {
  const data = {
    phases: [{ id: "p1", name: "Validate", start: "2026-10-01", end: "2026-10-31" }],
    people: [{ id: "a", name: "Drew Klein", side: "seller" }, { id: "b", name: "Olivia Grant", side: "buyer" }],
    tasks: [
      { id: "1", phase: "p1", title: "Security review", status: "Open", owner: "b", due: "2026-10-10" },
      { id: "2", phase: "p1", title: "POC", status: "Closed", owner: "a", due: "2026-10-05" },
      { id: "3", phase: "p1", title: "Sign-off", status: "Open", owner: "a", due: "2026-10-22", milestone: true },
      { id: "4", phase: "p1", parent: "3", title: "Draft", status: "Open", owner: "a", due: "2026-10-21" },
    ],
    activity: [{ at: "2026-10-19", by: "a", text: "closed “POC” by voice" }, { at: "2026-10-01", by: "b", text: "posted an update" }],
  };
  const text = briefing(data, "Meridian", "2026-10-19");
  assert.match(text, /You are in Validate/); assert.match(text, /1 of 3 main tasks is closed/); assert.match(text, /1 task is overdue: "Security review"/);
  assert.match(text, /2 tasks are due in the next 7 days/); assert.match(text, /We have 2 open tasks; Meridian has 1/); assert.match(text, /next milestone is "Sign-off"/);
  assert.equal(newsDays("what happened today"), 1); assert.equal(newsDays("what's new"), 7);
  assert.equal(whatsNew(data, "2026-10-19", 7), "1 change in the last 7 days. Newest: Drew closed “POC”.");
  assert.equal(whatsNew({ ...data, activity: [] }, "2026-10-19", 1), "Nothing has changed today.");
});

import { checkBulk, checkShift } from "../app/lib/close-plan-voice";
import { transcriptionSettings } from "../app/lib/voice-audio";
const bulkData = {
  phases: [{ id: "p1", name: "Validation", start: "2026-10-01", end: "2026-10-31" }, { id: "p2", name: "Close", start: "2026-11-01", end: "2026-11-30" }],
  people: [{ id: "a", name: "Drew", side: "seller" }],
  tasks: [
    { id: "1", phase: "p1", title: "A", status: "Open", due: "2026-10-10" }, { id: "2", phase: "p1", title: "B", status: "Open", due: "2026-10-12" },
    { id: "3", phase: "p1", parent: "1", title: "A1", status: "Open" }, { id: "4", phase: "p2", title: "C", status: "Closed", due: "2026-11-01" },
  ],
};
const prop = (m: Partial<Proposal>): Proposal => ({ mode: "act_many", answer: "", taskId: null, filter: null, personId: null, phaseId: null, actions: [], newTask: null, ...m });
const act = (a: Partial<VoiceAction>): VoiceAction => ({ type: "set_shared", status: null, text: null, date: null, personId: null, flag: false, ...a } as VoiceAction);

test("checkBulk: a phase or the list on screen, asked first with the count; one-task-only changes refused", () => {
  const byPhase = checkBulk(bulkData, prop({ phaseId: "p1", actions: [act({})] }), [], "make all tasks in Validation internal");
  assert.ok(byPhase.ok && byPhase.change.groups[0].taskIds.join() === "1,2" && /Make 2 tasks in Validation internal\? Say yes/.test(byPhase.question));
  const byList = checkBulk(bulkData, prop({ actions: [act({ type: "set_status", status: "Closed" })] }), ["1", "2", "3"], "close all of these");
  assert.ok(byList.ok && byList.change.groups[0].taskIds.length === 3 && /Set 3 tasks to Closed/.test(byList.question));
  assert.equal(checkBulk(bulkData, prop({ actions: [act({})] }), [], "make them internal").ok, false);
  assert.equal(checkBulk(bulkData, prop({ phaseId: "p1", actions: [act({ type: "delete_task" })] }), [], "delete all").ok, false);
});

test("checkShift: whole plan by days, tasks only when meant, bounded", () => {
  const all = checkShift(bulkData, 28, null, "move the whole plan back four weeks");
  assert.ok(all.ok && all.change.tasks && all.change.taskCount === 2 && /Move all 2 phases and the due dates of 2 open tasks 4 weeks later\?/.test(all.question));
  const phasesOnly = checkShift(bulkData, -3, false, "bring the phases forward three days");
  assert.ok(phasesOnly.ok && !phasesOnly.change.tasks && /3 days earlier/.test(phasesOnly.question));
  assert.equal(checkShift(bulkData, 0, null, "x").ok, false); assert.equal(checkShift(bulkData, 999, null, "x").ok, false);
});

test("checkPhaseEdit sort, person lists are open tasks only, transcription is English with a vocabulary", () => {
  const unsorted = { ...bulkData, phases: [bulkData.phases[1], bulkData.phases[0]] };
  const base = { sort: true, add: false, remove: false, name: null, goal: null, start: null, end: null, moveTo: null };
  const r = checkPhaseEdit(unsorted, null, base, "put the phases in date order", "2026-10-19");
  assert.ok(r.ok && r.edit.sort && /Validation, Close/.test(r.said));
  assert.equal(checkPhaseEdit(bulkData, null, base, "sort", "2026-10-19").ok, false);
  assert.deepEqual(listMatches({ ...bulkData, tasks: [{ id: "1", phase: "p1", status: "Closed", owner: "a" }, { id: "2", phase: "p1", status: "Open", owner: "a" }] }, "person", null, "2026-10-19", "a"), ["2"]);
  const t = transcriptionSettings("gpt-transcribe", ["CluePoints", "Drew Klein"]);
  assert.equal(t.language, "en"); assert.match(t.prompt, /CluePoints/);
});

import { checkView, shiftWords, upcomingIds } from "../app/lib/close-plan-voice";
test("named tasks, several kinds of change, and relative date moves", () => {
  const act2 = (a: Partial<VoiceAction>): VoiceAction => ({ type: "shift_due", status: null, text: null, date: null, personId: null, flag: null, days: 7, ...a } as VoiceAction);
  const named = checkBulk(bulkData, prop({ groups: [{ taskIds: ["1", "2"], actions: [act2({})] }, { taskIds: ["4"], actions: [act2({ type: "set_status", status: "Open", days: null })] }] }), [], "move A and B back a week and reopen C");
  assert.ok(named.ok && named.change.groups.length === 2 && named.change.groups[0].taskIds.join() === "1,2");
  assert.match(named.ok ? named.question : "", /Move "A" and "B" 1 week later and set "C" to Open\? Say yes/);
  // a task without a due date is left out of a relative move; none left = refused
  const noDue = checkBulk(bulkData, prop({ groups: [{ taskIds: ["3"], actions: [act2({})] }] }), [], "move A1 back a week");
  assert.equal(noDue.ok, false);
  assert.equal(checkBulk(bulkData, prop({ groups: [{ taskIds: ["zz"], actions: [act2({})] }] }), [], "x").ok, false);
  assert.equal(shiftWords(7), "1 week later"); assert.equal(shiftWords(-3), "3 days earlier");
  // one task: shift_due through the normal path
  const one = checkProposal(bulkData, { mode: "act", answer: "", taskId: "1", filter: null, personId: null, phaseId: null, actions: [act2({ days: -7 })], newTask: null }, null, "move it forward a week");
  assert.ok(one.ok && /Moved "A" 1 week earlier to /.test(describeActions(bulkData, "1", one.ok ? one.actions : [], "2026-10-19")));
});

test("up next, activity by side, collapsing phases, and delete needs the word delete", () => {
  assert.deepEqual(upcomingIds(bulkData), ["1", "2"]);
  const people = [{ id: "a", name: "Drew Klein", side: "seller" }, { id: "b", name: "Olivia Grant", side: "buyer" }];
  const d = { ...bulkData, people, activity: [{ at: "2026-10-19", by: "a", text: "closed “A”" }, { at: "2026-10-19", by: "a", text: "closed “B”" }, { at: "2026-10-18", by: "b", text: "posted an update" }] };
  assert.equal(whatsNew(d, "2026-10-19", 7, {}), "3 changes in the last 7 days. By person: Drew 2, Olivia 1. Newest: Drew closed “A”. Drew closed “B”. Olivia posted an update.");
  assert.equal(whatsNew(d, "2026-10-19", 7, { side: "buyer" }, "Meridian"), "1 change by Meridian people in the last 7 days. Newest: Olivia posted an update.");
  assert.equal(whatsNew({ ...d, activity: [d.activity[0]] }, "2026-10-19", 7, { side: "buyer" }, "Meridian"), "Nothing has changed by Meridian people in the last 7 days.");
  const v = checkView(bulkData, "p1", false); assert.ok(v.ok && v.said === "Collapsed Validation." && !v.open);
  const all = checkView(bulkData, null, true); assert.ok(all.ok && all.phaseIds.length === 2 && all.said === "Opened all phases.");
  const del = (say: string) => checkPhaseEdit(bulkData, "p1", { sort: false, add: false, remove: true, name: null, goal: null, start: null, end: null, moveTo: null }, say, "2026-10-19");
  assert.equal(del("collapse the phase Validation").ok, false);
  assert.equal(del("delete the phase Validation").ok, true);
});

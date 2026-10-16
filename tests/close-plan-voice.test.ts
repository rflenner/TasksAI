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

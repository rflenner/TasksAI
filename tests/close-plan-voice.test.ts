import assert from "node:assert/strict";
import test from "node:test";
import { calendar, checkProposal, confirmQuestion, grounded, describeTask, listLabel, listMatches, planContext, type Proposal, speakable, viewerId } from "../app/lib/close-plan-voice";

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

test("checkProposal for a new task: a subtask takes its parent's phase, unknown owner is dropped", () => {
  const r = checkProposal(plan(), { ...none, mode: "add_task", newTask: { title: " Send report ", phaseId: "p1", parentId: "t3", ownerId: "zz", due: "2026-10-09", internal: false } }, null);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.newTask, { title: "Send report", phaseId: "p2", parentId: "t3", ownerId: null, due: "2026-10-09", internal: false });
  assert.equal(checkProposal(plan(), { ...none, mode: "add_task", newTask: { title: "X", phaseId: "nope", parentId: null, ownerId: null, due: null, internal: false } }, null).ok, false);
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
  assert.equal(checkProposal(plan(), { ...none, mode: "add_task", newTask: { title: "Prepare onboarding deck", phaseId: "p1", parentId: null, ownerId: null, due: null, internal: false } }, null, "add a task").ok, false);
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

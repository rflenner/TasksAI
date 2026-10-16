import assert from "node:assert/strict";
import test from "node:test";
import { askQuestion, draftFromExtraction, mergeAnswer, missingFields, nextStep, sanitizeTaskDraft, type ExtractedForDraft, type KnownLists } from "../app/lib/voice-task-draft";
import { declinesMore, mentionsDate, namedIn } from "../app/lib/voice-grounding";

// Fictional data only — this repository is public.
const lists: KnownLists = { people: ["Rizan Flenner", "Maya Chen", "Drew Klein"], projects: ["Customer pilot", "Security"], topics: ["Technical setup"], meetings: ["Weekly delivery call"] };
const extracted = (o: Partial<ExtractedForDraft> = {}): ExtractedForDraft => ({ subject: "Send the invoice", description: "Send the invoice to the client", owner: null, collaborators: [], recipients: [], due: null, topic: null, project: null, recurringMeeting: null, ...o });

test("grounding helpers: names, dates and declining", () => {
  assert.equal(namedIn("assign it to Maya", "Maya Chen"), true);
  assert.equal(namedIn("send the invoice", "Maya Chen"), false);
  assert.equal(mentionsDate("by next Friday"), true);
  assert.equal(mentionsDate("send the invoice"), false);
  for (const u of ["skip", "Skip it.", "that's all", "no", "Nothing else", "leave it"]) assert.equal(declinesMore(u), true, u);
  for (const u of ["skip the review step", "no, assign it to Maya", "Maya"]) assert.equal(declinesMore(u), false, u);
});

test("a first request keeps only what was said; the rest is asked for once, with the known projects as hints", () => {
  // The extraction guessed a project, an owner, a date and a description nobody said.
  const d = draftFromExtraction(extracted({ project: "Security", owner: "Drew Klein", due: "2026-10-23", description: "Handle the invoicing process for the pilot customer" }), "create a task to send the invoice", "Rizan Flenner", lists);
  assert.deepEqual([d.project, d.owner, d.due, d.description], [null, null, null, null]);
  const step = nextStep(d, false, lists.projects);
  assert.equal(step.kind, "ask");
  if (step.kind === "ask") {
    assert.equal(step.question, `For "Send the invoice": Which project it belongs to, who should own it, when it's due and anything for the description? Or say skip. Projects: Customer pilot, Security.`);
    assert.equal(step.draft.askedDetails, true);
  }
});

test("what was said is kept: a named person, a date, a known project, an explicit description", () => {
  const said = "create a task in the security project to send the invoice to Maya, due next Friday, the description is the final invoice for the pilot";
  const d = draftFromExtraction(extracted({ project: "Security", owner: "Maya Chen", due: "2026-10-23", description: "the final invoice for the pilot" }), said, "Rizan Flenner", lists);
  assert.deepEqual([d.project, d.owner, d.due, d.description], ["Security", "Maya Chen", "2026-10-23", "the final invoice for the pilot"]);
  assert.deepEqual(missingFields(d), []);
  assert.equal(nextStep(d, false, lists.projects).kind, "create");
});

test("'me' means the speaker; an unknown project is not accepted", () => {
  const d = draftFromExtraction(extracted({ owner: "Rizan Flenner", project: "Made Up" }), "create a task for me to send the invoice", "Rizan Flenner", lists);
  assert.equal(d.owner, "Rizan Flenner");
  assert.equal(d.project, null);
});

test("the answer is merged, checked against the person's own words, and asks nothing twice", () => {
  const first = draftFromExtraction(extracted(), "create a task to send the invoice", "Rizan Flenner", lists);
  const asked = nextStep(first, false, lists.projects);
  assert.equal(asked.kind, "ask");
  const draft = asked.kind === "ask" ? asked.draft : first;
  // The AI also read an owner nobody named: dropped.
  const m = mergeAnswer(draft, "the pilot one, due Friday", { project: "Customer pilot", owner: "Drew Klein", due: "2026-10-23", description: null, topic: null, recurringMeeting: null }, "Rizan Flenner", lists);
  assert.equal(m.changed, true);
  assert.deepEqual([m.draft.project, m.draft.owner, m.draft.due], ["Customer pilot", null, "2026-10-23"]);
  const m2 = mergeAnswer(draft, "Customer pilot, Drew, due Friday, a reminder for the client", { project: "Customer pilot", owner: "Drew Klein", due: "2026-10-23", description: "a reminder for the client", topic: null, recurringMeeting: null }, "Rizan Flenner", lists);
  assert.deepEqual([m2.draft.project, m2.draft.owner, m2.draft.due, m2.draft.description], ["Customer pilot", "Drew Klein", "2026-10-23", "a reminder for the client"]);
  // Already asked once: whatever is still missing is defaulted, not asked again.
  const after = nextStep(m.draft, false, lists.projects);
  assert.equal(after.kind, "create");
  if (after.kind === "create") assert.deepEqual(after.defaults, ["owner"]);
});

test("an answer that adds nothing is not an answer (the caller handles it as a new request)", () => {
  const draft = { ...draftFromExtraction(extracted(), "create a task to send the invoice", "Rizan Flenner", lists), askedDetails: true };
  const m = mergeAnswer(draft, "what's overdue", { project: null, owner: null, due: null, description: null, topic: null, recurringMeeting: null }, "Rizan Flenner", lists);
  assert.equal(m.changed, false);
});

test("skip creates with defaults; a draft sent back by the page is cleaned", () => {
  const d = draftFromExtraction(extracted(), "create a task to send the invoice", "Rizan Flenner", lists);
  const step = nextStep(d, true, lists.projects);
  assert.equal(step.kind, "create");
  if (step.kind === "create") assert.deepEqual(step.defaults, ["owner", "due"]);
  assert.deepEqual(sanitizeTaskDraft({ subject: " Send ", owner: 5, due: "soon", collaborators: ["Maya", 3], askedDetails: "yes" }), { subject: "Send", description: null, owner: null, collaborators: ["Maya"], recipients: [], due: null, project: null, topic: null, recurringMeeting: null, askedDetails: false });
  assert.equal(sanitizeTaskDraft({ subject: " " }), null);
  assert.match(askQuestion({ ...d, project: "Security" }, []), /^For "Send the invoice": Who should own it, when it's due and anything for the description\? Or say skip\.$/);
});

test("in the first sentence the AI's echo of the task is not a description; in an answer it is", () => {
  const draft = draftFromExtraction(extracted({ subject: "Chase the signed quote" }), "create a task to chase the signed quote by Friday", "Rizan Flenner", lists);
  const fill = { project: null, owner: null, due: "2026-10-23", description: "chase the signed quote", topic: null, recurringMeeting: null };
  assert.equal(mergeAnswer(draft, "create a task to chase the signed quote by Friday", fill, "Rizan Flenner", lists, true).draft.description, null);
  assert.equal(mergeAnswer(draft, "create a task to chase the signed quote, the description is chase the signed quote", fill, "Rizan Flenner", lists, true).draft.description, "chase the signed quote");
  assert.equal(mergeAnswer(draft, "chase the signed quote with the legal team", { ...fill, description: "chase the signed quote with the legal team" }, "Rizan Flenner", lists).draft.description, "chase the signed quote with the legal team");
});

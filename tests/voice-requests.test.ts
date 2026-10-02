import assert from "node:assert/strict";
import test from "node:test";
import { cleanRequestName, rankRequests, type Ask } from "../app/lib/voice-requests";
import { HELP_SPOKEN, capabilities, isHelpRequest } from "../app/lib/close-plan-voice";

const ask = (requestName: string, userId: number, sessionId: string, kind = "unsupported", day = 1): Ask =>
  ({ requestName, kind, userId, actorName: `User ${userId}`, sessionId, surface: "close_plan", utterance: `${requestName} please`, createdAt: new Date(`2026-10-0${day}T10:00:00Z`) });

test("rankRequests: more people beats more repeats from one person", () => {
  const ranked = rankRequests([
    ask("Task History By Voice", 1, "a"), ask("Task History By Voice", 2, "b"), ask("Task History By Voice", 3, "c"),
    ask("Export To Excel", 1, "a"), ask("Export To Excel", 1, "d"), ask("Export To Excel", 1, "e"), ask("Export To Excel", 1, "f"),
  ]);
  assert.deepEqual(ranked.map(r => r.name), ["Task History By Voice", "Export To Excel"]);
  assert.equal(ranked[0].people, 3);
  assert.equal(ranked[1].times, 4);
});

test("rankRequests: wishes and asking again in one session add weight; status and note come along", () => {
  const ranked = rankRequests([
    ask("Send Invitations By Voice", 1, "s1"), ask("Send Invitations By Voice", 1, "s1", "unsupported", 2),
    ask("Meeting Agenda From Plan", 2, "s2", "wish"),
  ], new Map([["Meeting Agenda From Plan", { status: "planned", note: "Q4" }]]));
  const invite = ranked.find(r => r.name === "Send Invitations By Voice")!;
  assert.equal(invite.frustrated, 1);
  assert.equal(invite.lastAt.toISOString(), "2026-10-02T10:00:00.000Z");
  const agenda = ranked.find(r => r.name === "Meeting Agenda From Plan")!;
  assert.equal(agenda.wishes, 1);
  assert.equal(agenda.status, "planned");
  assert.equal(agenda.note, "Q4");
});

test("cleanRequestName keeps a short readable name", () => {
  assert.equal(cleanRequestName("  Open \"Task\" <History>!! "), "Open Task History");
  assert.equal(cleanRequestName("x".repeat(200)).length, 80);
});

test("help: recognised, spoken from the same list the panel shows", () => {
  for (const u of ["What can you do?", "what can I say", "help", "How can you help?"]) assert.equal(isHelpRequest(u), true, u);
  for (const u of ["What should I do next?", "Can you help Olivia with the criteria?"]) assert.equal(isHelpRequest(u), false, u);
  assert.match(HELP_SPOKEN("Cluepoints"), /what Cluepoints is waiting on/);
  const groups = capabilities("Cluepoints", "Validate", "Drew");
  assert.deepEqual(groups.map(g => g.group), ["Ask", "Find", "Change a task", "Add", "Ideas"]);
  assert.ok(groups[1].items.includes("What is Cluepoints waiting on?"));
});

test("pickRequestName reuses a known name only when it shares words with what was said", async () => {
  const { pickRequestName } = await import("../app/lib/voice-requests");
  const known = ["Send Invitations By Voice", "Task History By Voice"];
  assert.equal(pickRequestName("Invite Contacts", "Send Invitations By Voice", known, "send Olivia the invitation"), "Send Invitations By Voice");
  assert.equal(pickRequestName("Show Task History", "Send Invitations By Voice", known, "can you show me the history of this task?"), "Show Task History");
  assert.equal(pickRequestName("Who Changed A Task", "Task History By Voice", known, "who changed this task? I want to see its history"), "Task History By Voice");
  assert.equal(pickRequestName("Meeting Agenda", "Made Up Name", known, "prepare the agenda"), "Meeting Agenda");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  auditRowForVoiceQuery, cleanSessionId, cleanSource, formatSessionsAsText, groupIntoSessions, isProblem, isUnbackedReply, outcomeForResponse,
  parseAuditFilters, rowLabel, sanitizeClientAuditEvent, sessionMatches, summarizeSessions, type VoiceAuditCollector, type VoiceAuditRecord,
} from "../app/lib/voice-audit";

const emptyCollector = (): VoiceAuditCollector => ({ actor: { name: "Rizan Flenner" }, taskIds: [], changes: [] });

test("outcomeForResponse: writes are 'changed', lookups 'shown', 'unclear' is 'not_done', confirm modes wait", () => {
  assert.deepEqual(outcomeForResponse(true, { mode: "act" }), { mode: "act", outcome: "changed" });
  assert.deepEqual(outcomeForResponse(true, { mode: "created" }), { mode: "created", outcome: "changed" });
  assert.deepEqual(outcomeForResponse(true, { mode: "deleted" }), { mode: "deleted", outcome: "changed" });
  assert.equal(outcomeForResponse(true, { mode: "filter" }).outcome, "shown");
  assert.equal(outcomeForResponse(true, { mode: "briefing" }).outcome, "shown");
  assert.equal(outcomeForResponse(true, { mode: "unclear" }).outcome, "not_done");
  assert.equal(outcomeForResponse(true, { mode: "confirm_notify" }).outcome, "awaiting_confirmation");
  assert.equal(outcomeForResponse(true, { mode: "confirm_delete" }).outcome, "awaiting_confirmation");
});

test("outcomeForResponse: an HTTP failure or a non-JSON body is 'failed', whatever the mode says", () => {
  assert.equal(outcomeForResponse(false, { mode: "act" }).outcome, "failed");
  assert.equal(outcomeForResponse(true, null).outcome, "failed");
});

test("sanitizeClientAuditEvent: accepts the browser-reportable events and caps lengths", () => {
  const clean = sanitizeClientAuditEvent({ event: "heard", utterance: "x".repeat(5000), taskIds: [3, -1, 2.5, "7", 9] });
  assert.equal(clean?.event, "heard");
  assert.equal(clean?.utterance.length, 2000);
  assert.deepEqual(clean?.taskIds, [3, 9]); // only positive integers survive
});

test("sanitizeClientAuditEvent: a browser can't write server-only 'request' rows, or invent events/outcomes", () => {
  assert.equal(sanitizeClientAuditEvent({ event: "request" }), null);
  assert.equal(sanitizeClientAuditEvent({ event: "drop table" }), null);
  assert.equal(sanitizeClientAuditEvent("nope"), null);
  assert.equal(sanitizeClientAuditEvent({ event: "error", outcome: "made-up" })?.outcome, null);
});

test("sanitizeClientAuditEvent: an oversized or non-object detail is dropped, a modest one kept", () => {
  assert.deepEqual(sanitizeClientAuditEvent({ event: "said", detail: { kind: "direct" } })?.detail, { kind: "direct" });
  assert.deepEqual(sanitizeClientAuditEvent({ event: "said", detail: { blob: "x".repeat(5000) } })?.detail, {});
  assert.deepEqual(sanitizeClientAuditEvent({ event: "said", detail: ["a"] })?.detail, {});
});

test("cleanSessionId / cleanSource: strip junk and default safely", () => {
  assert.equal(cleanSessionId("abc-123_DEF"), "abc-123_DEF");
  assert.equal(cleanSessionId("a b;c<d>"), "abcd");
  assert.equal(cleanSessionId(undefined), "");
  assert.equal(cleanSource("live"), "live");
  assert.equal(cleanSource("anything else"), "ask");
});

test("isUnbackedReply / isProblem: an assistant reply with no Task AI call is flagged; one reading out a tool result is not", () => {
  assert.equal(isUnbackedReply({ event: "said", detail: { kind: "direct" } }), true);
  assert.equal(isUnbackedReply({ event: "said", detail: { kind: "tool_result" } }), false);
  assert.equal(isUnbackedReply({ event: "heard", detail: { kind: "direct" } }), false);
  assert.equal(isProblem({ event: "said", outcome: null, detail: { kind: "direct" } }), true);
  assert.equal(isProblem({ event: "request", outcome: "not_done", detail: {} }), true);
  assert.equal(isProblem({ event: "request", outcome: "failed", detail: {} }), true);
  assert.equal(isProblem({ event: "confirmation", outcome: "declined", detail: {} }), true);
  assert.equal(isProblem({ event: "error", outcome: null, detail: {} }), true);
  assert.equal(isProblem({ event: "request", outcome: "changed", detail: {} }), false);
  assert.equal(isProblem({ event: "request", outcome: "shown", detail: {} }), false);
});

test("auditRowForVoiceQuery: an act that changed a task records the changes and the task id", () => {
  const collector = { ...emptyCollector(), taskIds: [6], changes: ["#6 Prepare docs: checked off \"Call the client\""] };
  const row = auditRowForVoiceQuery({ transcript: "mark call the client done", currentTaskId: 6, sessionId: "s1", source: "live" }, true, { mode: "act", spokenAnswer: "Checked off." }, collector);
  assert.equal(row.event, "request");
  assert.equal(row.source, "live");
  assert.equal(row.sessionId, "s1");
  assert.equal(row.outcome, "changed");
  assert.deepEqual(row.taskIds, [6]);
  assert.deepEqual(row.detail.changes, ["#6 Prepare docs: checked off \"Call the client\""]);
  assert.equal(row.utterance, "mark call the client done");
});

test("auditRowForVoiceQuery: a refusal is 'not_done' and keeps the reason the assistant gave", () => {
  const row = auditRowForVoiceQuery({ transcript: "notify Pavneet", currentTaskId: 6 }, true, { mode: "unclear", spokenAnswer: "Pavneet isn't someone I can notify on this task." }, emptyCollector());
  assert.equal(row.outcome, "not_done");
  assert.match(row.spokenAnswer, /isn't someone I can notify/);
  assert.deepEqual(row.taskIds, []); // a refusal touched no task — the open one is context, not a target
  assert.equal(row.detail.currentTaskId, 6);
  assert.equal(row.source, "ask"); // no source sent -> the original assistant
});

test("auditRowForVoiceQuery: a drafted-but-unsent notify records who/where/what, as awaiting confirmation", () => {
  const row = auditRowForVoiceQuery(
    { transcript: "let the owner know", currentTaskId: 6 }, true,
    { mode: "confirm_notify", spokenAnswer: "should I send it?", pendingNotify: { taskId: 6, toName: "Shankar Morwal", channel: "email", message: "Hi Shankar" } },
    emptyCollector(),
  );
  assert.equal(row.outcome, "awaiting_confirmation");
  assert.deepEqual(row.detail.pendingNotify, { to: "Shankar Morwal", channel: "email", message: "Hi Shankar" });
});

test("auditRowForVoiceQuery: a created task and a confirmed delete name their task ids; a failure keeps the error", () => {
  const created = auditRowForVoiceQuery({ transcript: "create a task to send the invoice" }, true, { mode: "created", task: { id: 12, subject: "Send the invoice" }, spokenAnswer: "Created." }, emptyCollector());
  assert.deepEqual(created.taskIds, [12]);
  assert.equal(created.detail.createdSubject, "Send the invoice");
  const deleted = auditRowForVoiceQuery({ confirmDeleteTaskId: 9 }, true, { mode: "deleted", deletedTaskId: 9, spokenAnswer: "Deleted." }, emptyCollector());
  assert.equal(deleted.utterance, "[confirmed delete of task #9]");
  assert.deepEqual(deleted.taskIds, [9]);
  const failed = auditRowForVoiceQuery({ transcript: "x" }, false, { error: "Could not process that" }, emptyCollector());
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.detail.error, "Could not process that");
});

let nextId = 1;
const record = (overrides: Partial<VoiceAuditRecord>): VoiceAuditRecord => ({
  id: nextId++, createdAt: new Date("2026-10-02T10:00:00Z"), actorName: "Rizan Flenner", sessionId: "s1", source: "live",
  event: "request", utterance: "", mode: null, outcome: null, taskIds: [], spokenAnswer: "", detail: {}, ...overrides,
});

test("groupIntoSessions: groups by session, events oldest-first, sessions newest-first", () => {
  const rows = [
    record({ sessionId: "old", createdAt: new Date("2026-10-01T09:00:00Z") }),
    record({ sessionId: "new", createdAt: new Date("2026-10-02T10:05:00Z"), utterance: "second" }),
    record({ sessionId: "new", createdAt: new Date("2026-10-02T10:00:00Z"), utterance: "first" }),
  ];
  const sessions = groupIntoSessions(rows);
  assert.deepEqual(sessions.map(s => s.key), ["new", "old"]);
  assert.deepEqual(sessions[0].events.map(e => e.utterance), ["first", "second"]);
});

test("groupIntoSessions: rows with no session id each stand alone", () => {
  const sessions = groupIntoSessions([record({ sessionId: "" }), record({ sessionId: "" })]);
  assert.equal(sessions.length, 2);
});

test("sessionMatches / summarizeSessions: filters keep the whole session around a match and count changes vs problems", () => {
  const [clean, bad] = [
    { ...groupIntoSessions([record({ sessionId: "a", outcome: "shown" })])[0] },
    { ...groupIntoSessions([record({ sessionId: "b", outcome: "changed" }), record({ sessionId: "b", outcome: "not_done" })])[0] },
  ];
  assert.equal(sessionMatches(clean, "all"), true);
  assert.equal(sessionMatches(clean, "changes"), false);
  assert.equal(sessionMatches(clean, "problems"), false);
  assert.equal(sessionMatches(bad, "changes"), true);
  assert.equal(sessionMatches(bad, "problems"), true);
  assert.deepEqual(summarizeSessions([clean, bad]), { sessions: 2, changes: 1, problems: 1 });
});

test("rowLabel: each kind of row gets a distinct, honest label", () => {
  assert.equal(rowLabel({ event: "request", outcome: "changed", mode: "act", detail: {} }).label, "Changed");
  assert.equal(rowLabel({ event: "request", outcome: "not_done", mode: "unclear", detail: {} }).tone, "warn");
  assert.equal(rowLabel({ event: "request", outcome: "failed", mode: null, detail: {} }).tone, "bad");
  assert.equal(rowLabel({ event: "confirmation", outcome: "sent", mode: "notify", detail: {} }).label, "Sent");
  assert.equal(rowLabel({ event: "said", outcome: null, mode: null, detail: { kind: "direct" } }).tone, "bad");
  assert.equal(rowLabel({ event: "said", outcome: null, mode: null, detail: { kind: "tool_result" } }).label, "Assistant said");
  assert.equal(rowLabel({ event: "heard", outcome: null, mode: null, detail: {} }).label, "Heard");
});

test("auditRowForVoiceQuery: a lookup that opens a task attributes it to THAT task, not to whatever was on screen", () => {
  const row = auditRowForVoiceQuery({ transcript: "what's the first one", currentTaskId: 6, source: "live" }, true, { mode: "open_task", openTaskId: 12, spokenAnswer: "Number 1 of 5." }, emptyCollector());
  assert.deepEqual(row.taskIds, [12]);
  assert.equal(row.detail.currentTaskId, 6);
  const next = auditRowForVoiceQuery({ action: "next", currentTaskId: 12 }, true, { mode: "next", nextTaskId: 13, spokenAnswer: "x" }, emptyCollector());
  assert.equal(next.utterance, "[next task]");
  assert.deepEqual(next.taskIds, [13]);
});

test("rowLabel: the opening greeting is not flagged as an answer given without asking Task AI", () => {
  assert.equal(rowLabel({ event: "said", outcome: null, mode: null, detail: { kind: "greeting" } }).label, "Assistant said");
  assert.equal(isProblem({ event: "said", outcome: null, detail: { kind: "greeting" } }), false);
});

test("parseAuditFilters: defaults to everything/7 days and ignores anything it doesn't recognise", () => {
  assert.deepEqual(parseAuditFilters({}), { source: "all", show: "all", days: 7 });
  assert.deepEqual(parseAuditFilters({ source: "live", show: "problems", days: "30" }), { source: "live", show: "problems", days: 30 });
  assert.deepEqual(parseAuditFilters({ source: "x", show: "y", days: "1234" }), { source: "all", show: "all", days: 7 });
});

test("formatSessionsAsText: a paste-friendly report with what was heard, understood, said, changed and why something failed", () => {
  const at = (time: string) => new Date(`2026-10-02T${time}Z`);
  const sessions = groupIntoSessions([
    record({ id: 1, sessionId: "s9", createdAt: at("13:11:00"), event: "heard", utterance: "show me my overdue tasks" }),
    record({ id: 2, sessionId: "s9", createdAt: at("13:11:02"), event: "request", utterance: "show me my overdue tasks", mode: "filter", outcome: "shown", spokenAnswer: "Showing 4 overdue tasks.", detail: { currentTaskId: 6 } }),
    record({ id: 3, sessionId: "s9", createdAt: at("13:12:10"), event: "request", utterance: "mark it done", mode: "act", outcome: "changed", taskIds: [7], detail: { changes: ["#7 Chase invoice: changed status Open → Closed"] } }),
    record({ id: 4, sessionId: "s9", createdAt: at("13:12:30"), event: "said", spokenAnswer: "Done, I sent it.", detail: { kind: "direct" } }),
    record({ id: 5, sessionId: "s9", createdAt: at("13:12:40"), event: "request", utterance: "notify Pavneet", mode: "unclear", outcome: "not_done", spokenAnswer: "Pavneet isn't someone I can notify." }),
  ]);
  const text = formatSessionsAsText(sessions, { source: "all", show: "all", days: 7 }, new Date("2026-10-02T14:00:00Z"));
  assert.match(text, /^VOICE AUDIT TRAIL — exported 2026-10-02 14:00:00 UTC/);
  assert.match(text, /1 session · 1 change made · 2 problems/);
  assert.match(text, /=== 2026-10-02 13:11:00 UTC · Rizan Flenner · Live Voice Assistant · 5 events · session s9 ===/);
  assert.match(text, /13:11:00 {2}\[Heard\] "show me my overdue tasks"/);
  assert.match(text, /understood as: filter/);
  assert.match(text, /on screen: #6/);
  assert.match(text, /→ Showing 4 overdue tasks\./);
  assert.match(text, /• #7 Chase invoice: changed status Open → Closed/);
  assert.match(text, /!! \[Answered on its own[^\]]*\] Assistant: Done, I sent it\./);
  assert.match(text, /!! \[[^\]]*\] "notify Pavneet"/);
  assert.match(text, /tasks: #7/);
});

test("formatSessionsAsText: an empty export says so instead of printing nothing", () => {
  assert.match(formatSessionsAsText([], null, new Date("2026-10-02T14:00:00Z")), /\(nothing recorded for these filters\)/);
});

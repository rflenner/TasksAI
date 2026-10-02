// Voice audit trail (requested 2026-10-02: "an audit trail what was
// created, changed and done by voice live and what did not ... good to
// debug"). Pure helpers first (classify an outcome, sanitize what a
// browser reports, flag replies that weren't backed by any Task AI
// action), then the small DB layer. Rows come from two places:
//   - the server, authoritative: every /api/voice-query call is logged by
//     app/api/voice-query/route.ts's POST wrapper with what was asked, how
//     it was understood, and what actually changed (or why nothing did);
//   - the browser, via /api/voice-audit, for the things the server never
//     sees: what the person actually said and what the assistant said back
//     (Live Voice Assistant), notify yes/no outcomes, session start/stop,
//     and transport errors.
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../../db";
import { voiceAudit } from "../../db/schema";

export const VOICE_AUDIT_SOURCES = ["live", "ask"] as const;
export type VoiceAuditSource = (typeof VOICE_AUDIT_SOURCES)[number];

// request: one /api/voice-query call (server-logged). heard: transcript
// of what the person said. said: what the assistant said aloud.
// confirmation: how a yes/no gate (notify/delete) resolved. session:
// start/stop/connect failure. error: a transport/tool-bridge failure.
export const VOICE_AUDIT_EVENTS = ["request", "heard", "said", "confirmation", "session", "error"] as const;
export type VoiceAuditEvent = (typeof VOICE_AUDIT_EVENTS)[number];

// changed: wrote something (task updated/created/deleted). shown: read-
// only (filtered the list, answered, opened a screen). awaiting_
// confirmation: drafted something outward-facing, waiting on a yes/no.
// sent / declined: how that yes/no turned out. not_done: understood but
// couldn't or wouldn't (unclear, no permission, no such task). failed: an
// actual error.
export const VOICE_AUDIT_OUTCOMES = ["changed", "shown", "awaiting_confirmation", "sent", "declined", "not_done", "failed"] as const;
export type VoiceAuditOutcome = (typeof VOICE_AUDIT_OUTCOMES)[number];

export type VoiceAuditRow = {
  sessionId: string; source: VoiceAuditSource; event: VoiceAuditEvent;
  utterance: string; mode: string | null; outcome: VoiceAuditOutcome | null;
  taskIds: number[]; spokenAnswer: string; detail: Record<string, unknown>;
};

// What the route handler fills in while it works, so the POST wrapper can
// log exactly what changed without re-deriving it from the response.
export type VoiceAuditCollector = {
  actor: { id?: number; name: string } | null;
  taskIds: number[];
  changes: string[];
};

const MODE_OUTCOME: Record<string, VoiceAuditOutcome> = {
  act: "changed", created: "changed", deleted: "changed",
  confirm_delete: "awaiting_confirmation", confirm_notify: "awaiting_confirmation",
  unclear: "not_done", unsupported: "not_done",
  filter: "shown", walk: "shown", briefing: "shown", navigate: "shown", next: "shown", answer: "shown", help: "shown", wish: "shown",
};

// An HTTP failure, or a body that isn't JSON at all, is a real failure; a
// mode of "unclear" is the route's own way of saying "I understood the
// request but didn't (or wouldn't) do it" — kept distinct, since that's
// exactly the "what did not" the audit exists to surface.
export function outcomeForResponse(httpOk: boolean, json: { mode?: string } | null): { mode: string | null; outcome: VoiceAuditOutcome } {
  if (!httpOk || !json) return { mode: json?.mode ?? null, outcome: "failed" };
  const mode = json.mode ?? null;
  return { mode, outcome: (mode && MODE_OUTCOME[mode]) || "shown" };
}

const clip = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";

// Everything the browser reports is untrusted input: only the vocabulary
// above is accepted, strings are length-capped, task ids must be small
// positive integers, and `detail` must be a modest plain object. Returns
// null for anything that isn't a recognizable client-reportable event
// ("request" rows are server-only — a browser can't write its own).
const CLIENT_EVENTS: readonly VoiceAuditEvent[] = ["heard", "said", "confirmation", "session", "error"];
export function sanitizeClientAuditEvent(raw: unknown): Omit<VoiceAuditRow, "sessionId" | "source"> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!CLIENT_EVENTS.includes(r.event as VoiceAuditEvent)) return null;
  const outcome = VOICE_AUDIT_OUTCOMES.includes(r.outcome as VoiceAuditOutcome) ? (r.outcome as VoiceAuditOutcome) : null;
  const taskIds = Array.isArray(r.taskIds) ? r.taskIds.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 20) : [];
  let detail: Record<string, unknown> = {};
  if (r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) && JSON.stringify(r.detail).length <= 4000) detail = r.detail as Record<string, unknown>;
  return {
    event: r.event as VoiceAuditEvent, utterance: clip(r.utterance, 2000), mode: clip(r.mode, 40) || null,
    outcome, taskIds, spokenAnswer: clip(r.spokenAnswer, 2000), detail,
  };
}

export function cleanSessionId(raw: unknown): string { return clip(raw, 64).replace(/[^\w-]/g, ""); }
export function cleanSource(raw: unknown): VoiceAuditSource { return raw === "live" ? "live" : "ask"; }

// A "said" row carries detail.kind (set by the Live Voice Assistant from
// the shape of the realtime response itself, so it doesn't depend on the
// order transcripts happen to arrive in): "direct" = the assistant spoke
// without calling Task AI at all; "tool_result" = it spoke the answer to a
// tool call; "with_tool_call" = it spoke while also calling the tool. A
// "direct" reply that sounds like an action ("I've marked it done") is the
// failure mode this exists to catch — the model claiming something happened
// when no Task AI call was ever made — so it's flagged for the viewer.
export function isUnbackedReply(row: { event: string; detail: Record<string, unknown> }): boolean {
  return row.event === "said" && row.detail.kind === "direct";
}

// Task AI acted on something other than a plain lookup or a screen change.
export function isProblem(row: { event: string; outcome: string | null; detail: Record<string, unknown> }): boolean {
  return row.outcome === "not_done" || row.outcome === "failed" || row.outcome === "declined" || row.event === "error" || isUnbackedReply(row);
}

// Opportunistic retention: voice transcripts are sensitive, so rows older
// than this are deleted — at most once an hour per server process, piggy-
// backing on writes instead of needing a cron job.
export const VOICE_AUDIT_RETENTION_DAYS = 90;
let lastPrunedAt = 0;

export async function recordVoiceAudit(actor: { id?: number; name: string }, rows: VoiceAuditRow[]): Promise<void> {
  if (!rows.length) return;
  const db = getDb();
  await db.insert(voiceAudit).values(rows.map(row => ({
    userId: actor.id ?? null, actorName: actor.name, sessionId: row.sessionId, source: row.source, event: row.event,
    utterance: row.utterance, mode: row.mode, outcome: row.outcome, taskIds: row.taskIds, spokenAnswer: row.spokenAnswer, detail: row.detail,
  })));
  if (Date.now() - lastPrunedAt > 3_600_000) {
    lastPrunedAt = Date.now();
    await db.delete(voiceAudit).where(lt(voiceAudit.createdAt, new Date(Date.now() - VOICE_AUDIT_RETENTION_DAYS * 86_400_000)));
  }
}

// Builds the server-side "request" row from one /api/voice-query exchange.
export function auditRowForVoiceQuery(
  body: { transcript?: unknown; currentTaskId?: unknown; confirmDeleteTaskId?: unknown; sessionId?: unknown; source?: unknown; action?: unknown },
  httpOk: boolean,
  json: Record<string, unknown> | null,
  collector: VoiceAuditCollector,
): VoiceAuditRow {
  const { mode, outcome } = outcomeForResponse(httpOk, json as { mode?: string } | null);
  const deleteId = typeof body.confirmDeleteTaskId === "number" ? body.confirmDeleteTaskId : null;
  const utterance = clip(body.transcript, 2000).trim() || (deleteId != null ? `[confirmed delete of task #${deleteId}]` : body.action === "next" ? "[next task]" : "");
  const task = json?.task as { id?: unknown; subject?: unknown } | null | undefined;
  const pendingNotify = json?.pendingNotify as { taskId?: number; toName?: string; channel?: string; message?: string } | null | undefined;
  const taskIds = new Set<number>(collector.taskIds);
  if (mode === "created" && typeof task?.id === "number") taskIds.add(task.id);
  if (typeof json?.deletedTaskId === "number") taskIds.add(json.deletedTaskId);
  if (typeof json?.pendingDeleteTaskId === "number") taskIds.add(json.pendingDeleteTaskId);
  if (pendingNotify?.taskId) taskIds.add(pendingNotify.taskId);
  // The tasks this request actually opened, moved to or acted on — NOT
  // whichever task happened to be open on screen. That was the old
  // fallback, and it made a refusal or a lookup look like it had touched
  // the open task (a live audit row for "open the first one" listed an
  // unrelated task). What was on screen is kept separately, in
  // detail.currentTaskId, for context.
  if (typeof json?.openTaskId === "number") taskIds.add(json.openTaskId);
  if (typeof json?.nextTaskId === "number") taskIds.add(json.nextTaskId);
  const detail: Record<string, unknown> = {};
  if (typeof body.currentTaskId === "number") detail.currentTaskId = body.currentTaskId;
  if (collector.changes.length) detail.changes = collector.changes.slice(0, 40);
  if (mode === "created" && typeof task?.subject === "string") detail.createdSubject = task.subject;
  if (pendingNotify) detail.pendingNotify = { to: pendingNotify.toName, channel: pendingNotify.channel, message: clip(pendingNotify.message, 1000) };
  if (!httpOk && typeof json?.error === "string") detail.error = json.error;
  return {
    sessionId: cleanSessionId(body.sessionId), source: cleanSource(body.source), event: "request",
    utterance, mode, outcome, taskIds: [...taskIds].slice(0, 20), spokenAnswer: clip(json?.spokenAnswer, 2000), detail,
  };
}

// ---- Viewer helpers (app/voice-audit/page.tsx) — pure, so the grouping
// and "what counts as a problem" rules are unit-testable without a DB. ----

export type VoiceAuditRecord = {
  id: number; createdAt: Date; actorName: string; sessionId: string; source: string; event: string;
  utterance: string; mode: string | null; outcome: string | null; taskIds: number[]; spokenAnswer: string; detail: Record<string, unknown>;
};
export type VoiceAuditSession = { key: string; actorName: string; source: string; startedAt: Date; endedAt: Date; events: VoiceAuditRecord[] };
export type VoiceAuditShow = "all" | "changes" | "problems";

// One session per sessionId (rows with no session id each stand alone, so
// an old or malformed row never swallows unrelated ones). Events inside a
// session read oldest-first like a conversation; sessions themselves are
// newest-first. Ties broken by row id so the order is always stable.
export function groupIntoSessions(rows: VoiceAuditRecord[]): VoiceAuditSession[] {
  const byKey = new Map<string, VoiceAuditSession>();
  for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)) {
    const key = row.sessionId || `row-${row.id}`;
    const existing = byKey.get(key);
    if (existing) { existing.events.push(row); existing.endedAt = row.createdAt; }
    else byKey.set(key, { key, actorName: row.actorName, source: row.source, startedAt: row.createdAt, endedAt: row.createdAt, events: [row] });
  }
  return [...byKey.values()].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
}

export function isChange(row: { outcome: string | null }): boolean { return row.outcome === "changed" || row.outcome === "sent"; }

// A whole session is kept when ANY of its events matches, so the rows
// around a problem (what was said just before it) stay visible.
export function sessionMatches(session: VoiceAuditSession, show: VoiceAuditShow): boolean {
  if (show === "changes") return session.events.some(isChange);
  if (show === "problems") return session.events.some(isProblem);
  return true;
}

export function summarizeSessions(sessions: VoiceAuditSession[]): { sessions: number; changes: number; problems: number } {
  let changes = 0, problems = 0;
  for (const session of sessions) for (const row of session.events) { if (isChange(row)) changes++; if (isProblem(row)) problems++; }
  return { sessions: sessions.length, changes, problems };
}

export type RowTone = "good" | "neutral" | "warn" | "bad" | "info";
// The one-glance label for a row — what the viewer shows in its pill.
export function rowLabel(row: { event: string; outcome: string | null; mode: string | null; detail: Record<string, unknown> }): { label: string; tone: RowTone } {
  if (row.event === "heard") return { label: "Heard", tone: "info" };
  if (row.event === "said") return isUnbackedReply(row) ? { label: "Answered on its own — no Task AI action", tone: "bad" } : { label: "Assistant said", tone: "neutral" };
  if (row.event === "session") return row.outcome === "failed" ? { label: "Session problem", tone: "bad" } : { label: row.mode === "stopped" ? "Session ended" : "Session started", tone: "neutral" };
  if (row.event === "error") return { label: "Error", tone: "bad" };
  switch (row.outcome) {
    case "changed": return { label: row.event === "confirmation" ? "Done" : "Changed", tone: "good" };
    case "sent": return { label: "Sent", tone: "good" };
    case "shown": return { label: "Looked up / shown", tone: "neutral" };
    case "awaiting_confirmation": return { label: "Waiting for yes/no", tone: "warn" };
    case "declined": return { label: "Declined / not confirmed", tone: "warn" };
    case "not_done": return { label: "Not done", tone: "warn" };
    case "failed": return { label: "Failed", tone: "bad" };
    default: return { label: row.event, tone: "neutral" };
  }
}

// ---- Filters, loading and plain-text export (shared by the viewer page
// and /api/voice-audit/export, so what you see and what you copy or
// download are always built from the same code). ----

export const VOICE_AUDIT_PERIODS: number[] = [1, 7, 30, VOICE_AUDIT_RETENTION_DAYS];
export const VOICE_AUDIT_MAX_ROWS = 1500;
export type VoiceAuditFilters = { source: "all" | VoiceAuditSource; show: VoiceAuditShow; days: number };

export function parseAuditFilters(params: Record<string, string | undefined>): VoiceAuditFilters {
  const source = params.source === "live" || params.source === "ask" ? params.source : "all";
  const show: VoiceAuditShow = params.show === "changes" || params.show === "problems" ? params.show : "all";
  const days = VOICE_AUDIT_PERIODS.includes(Number(params.days)) ? Number(params.days) : 7;
  return { source, show, days };
}

// With `sessionId`, loads exactly that one session (whatever its age,
// ignoring the other filters) — for "copy this session". Otherwise the
// newest rows inside the filter window, grouped and show-filtered.
export async function loadVoiceAuditSessions(filters: VoiceAuditFilters, sessionId?: string): Promise<{ sessions: VoiceAuditSession[]; rowLimitHit: boolean }> {
  const db = getDb();
  if (sessionId) {
    const isLoose = sessionId.startsWith("row-");
    const rows = await db.select().from(voiceAudit).where(isLoose ? eq(voiceAudit.id, Number(sessionId.slice(4)) || 0) : eq(voiceAudit.sessionId, cleanSessionId(sessionId)));
    return { sessions: groupIntoSessions(rows as VoiceAuditRecord[]), rowLimitHit: false };
  }
  const since = new Date(Date.now() - filters.days * 86_400_000);
  const rows = await db.select().from(voiceAudit)
    .where(and(gte(voiceAudit.createdAt, since), filters.source === "all" ? undefined : eq(voiceAudit.source, filters.source)))
    .orderBy(desc(voiceAudit.createdAt)).limit(VOICE_AUDIT_MAX_ROWS);
  return { sessions: groupIntoSessions(rows as VoiceAuditRecord[]).filter(session => sessionMatches(session, filters.show)), rowLimitHit: rows.length >= VOICE_AUDIT_MAX_ROWS };
}

const SOURCE_NAME: Record<string, string> = { live: "Live Voice Assistant", ask: "Ask Task AI" };
const utcStamp = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// A readable, paste-friendly report: one block per session, one entry
// per row, every timestamp UTC. Meant to be copied into a chat or an
// email as-is, so it carries everything needed to understand a session
// without the page (what was heard, how it was understood, what changed,
// why something wasn't done) and nothing decorative.
export function formatSessionsAsText(sessions: VoiceAuditSession[], filters: VoiceAuditFilters | null, exportedAt: Date): string {
  const totals = summarizeSessions(sessions);
  const lines: string[] = [
    `VOICE AUDIT TRAIL — exported ${utcStamp(exportedAt)} UTC`,
    filters ? `Filters: assistant=${filters.source} · show=${filters.show} · last ${filters.days} day${filters.days === 1 ? "" : "s"}` : "Single session",
    `${totals.sessions} session${totals.sessions === 1 ? "" : "s"} · ${totals.changes} change${totals.changes === 1 ? "" : "s"} made · ${totals.problems} problem${totals.problems === 1 ? "" : "s"}`,
    'All times UTC. "Heard" is a separate transcript of the audio, not necessarily what the assistant understood — the request rows show what it actually acted on.',
  ];
  for (const session of sessions) {
    lines.push("", `=== ${utcStamp(session.startedAt)} UTC · ${session.actorName} · ${SOURCE_NAME[session.source] ?? session.source} · ${session.events.length} events · session ${session.key} ===`);
    const startDay = session.startedAt.toISOString().slice(0, 10);
    for (const row of session.events) {
      const iso = row.createdAt.toISOString();
      const when = iso.slice(0, 10) === startDay ? iso.slice(11, 19) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
      const { label } = rowLabel(row);
      const flag = isProblem(row) ? "!! " : "";
      const text = row.event === "said" ? "" : oneLine(row.utterance);
      const head = `${when}  ${flag}[${label}]`;
      lines.push(row.event === "said" ? `${head} Assistant: ${oneLine(row.spokenAnswer)}` : text ? `${head} "${text}"` : head);
      const pad = "          ";
      if (row.event === "request" && row.mode) lines.push(`${pad}understood as: ${row.mode}`);
      if (row.event === "request" && typeof row.detail.currentTaskId === "number") lines.push(`${pad}on screen: #${row.detail.currentTaskId}`);
      if (row.event !== "said" && row.spokenAnswer) lines.push(`${pad}→ ${oneLine(row.spokenAnswer)}`);
      if (Array.isArray(row.detail.changes)) for (const change of row.detail.changes as string[]) lines.push(`${pad}• ${oneLine(change)}`);
      const target = (row.detail.pendingNotify ?? (row.event === "confirmation" ? row.detail : null)) as { to?: string; channel?: string; message?: string } | null;
      if (target?.to) lines.push(`${pad}notify: to ${target.to} via ${target.channel} — "${oneLine(target.message || "").slice(0, 300)}"`);
      if (row.detail.createdSubject) lines.push(`${pad}created: ${oneLine(String(row.detail.createdSubject))}`);
      if (row.detail.error) lines.push(`${pad}error: ${oneLine(String(row.detail.error))}`);
      if (row.event === "session" && row.detail.model) lines.push(`${pad}model: ${String(row.detail.model)}`);
      if (row.taskIds.length) lines.push(`${pad}tasks: ${row.taskIds.map(id => `#${id}`).join(", ")}`);
    }
  }
  if (!sessions.length) lines.push("", "(nothing recorded for these filters)");
  return `${lines.join("\n")}\n`;
}

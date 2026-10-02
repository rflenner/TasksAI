"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { interpretConfirmReply } from "../lib/voice-confirm";
import type { PendingNotify, VoiceCreatedTask, VoiceDimensions, VoiceFilters, VoiceNavigateTarget, VoiceTaskUpdate } from "./VoiceAsk";
import { newVoiceSessionId, reportVoiceAudit, type ClientAuditEvent } from "./voice-audit-client";

// "Live Voice Assistant" (requested 2026-10-02) — the true voice-to-voice
// alternative to the Deepgram-based "Ask Task AI" (VoiceAsk.tsx), sitting
// side by side with it rather than replacing it. Talks directly to
// OpenAI's Realtime API over WebRTC (continuous, interruptible, no
// record-then-wait turn-taking) instead of VoiceAsk's record -> transcribe
// -> classify -> speak loop — first proven out on the throwaway
// /voice-test-realtime comparison page, which now shares this component's
// session-minting route (app/api/voice-live/session/route.ts).
//
// The realtime session itself has two tools it can call — ask_task_ai
// (utterance) and next_task — defined server-side at session-mint time, so
// all the actual thinking (classify, permission checks, DB reads/writes)
// stays in app/api/voice-query/route.ts, shared with VoiceAsk. This
// component's runTool() below is deliberately the same dispatch shape as
// VoiceAsk's ask(): same request body, same mode-by-mode handling of the
// response, same onX screen-sync callbacks, same pendingDelete/
// pendingNotify confirm-then-execute gates for the two actions that reach
// outside Task AI itself (deleting a task, messaging someone). The only
// real difference is HOW the answer reaches the person: VoiceAsk calls
// Deepgram TTS and plays it back itself; here, the answer is handed back
// as the tool's own output and OpenAI's realtime model speaks it as part
// of the live conversation.
//
// Reworked the same day after the first real sessions (see the voice audit
// trail): the realtime model keeps no list state of its own, so THIS
// component now remembers the list being walked (its label, filters, ids
// and where in it the person is) and sends it with every request; the
// classifier is told about it and "the first one" / "next" resolve against
// it. The panel is now compact and minimisable, auto-scrolls, shows what
// was heard as it is heard, and the session starts (mic on, greeting
// spoken) the moment the button is clicked.

type Status = "idle" | "connecting" | "connected" | "error";
type HistoryEntry = { role: "you" | "assistant"; text: string };
// What the panel shows, in order: what the person said (live, as it is
// transcribed), what was passed on to Task AI, Task AI's answer, and
// anything the assistant said on its own (the greeting, small talk).
type FeedKind = "heard" | "asked" | "result" | "said";
type FeedItem = { id: string; kind: FeedKind; text: string; pending?: boolean };

type QueryResult = {
  mode?: string; filters?: VoiceFilters | null; navigateTarget?: VoiceNavigateTarget | null;
  workingListIds?: number[]; listLabel?: string | null; task?: VoiceTaskUpdate | VoiceCreatedTask | null; tasks?: VoiceTaskUpdate[] | null;
  nextTaskId?: number | null; openTaskId?: number | null;
  dimensions?: VoiceDimensions; pendingDeleteTaskId?: number | null; pendingNotify?: PendingNotify | null;
  deletedTaskId?: number | null; spokenAnswer?: string; error?: string;
};

type RealtimeEvent = {
  type?: string; call_id?: string; name?: string; arguments?: string; transcript?: string; response_id?: string; item_id?: string; delta?: string;
  response?: { id?: string; status?: string; status_details?: { error?: { message?: string } }; output?: Array<{ type?: string; content?: Array<{ transcript?: string; text?: string }> }> };
  error?: { message?: string; type?: string; code?: string | null };
};

const GREETING = "Hi, I am your Task AI voice assistant. How can I help?";
// A response that never reports back as finished must not block the
// conversation forever — after this long it no longer counts as active.
const RESPONSE_STALE_MS = 30000;

function describeMicError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  const hint =
    name === "NotAllowedError" ? "permission was denied — check your browser and system microphone settings." :
    name === "NotFoundError" ? "no microphone was found." :
    name === "NotReadableError" ? "the microphone is in use by another app." :
    "an unexpected error occurred.";
  return name ? `Microphone error (${name}): ${hint}` : "Microphone access failed.";
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export default function VoiceAskRealtime({ onApplyFilters, onNavigate, onTaskUpdated, onOpenTask, onTaskCreated, onTaskDeleted, onShowTasks, currentTaskId, currentTaskLabel, drawerOpen }: {
  onApplyFilters: (filters: VoiceFilters) => void;
  onNavigate: (target: VoiceNavigateTarget) => void;
  onTaskUpdated: (task: VoiceTaskUpdate) => void;
  onOpenTask: (taskId: number) => void;
  onTaskCreated: (task: VoiceCreatedTask, dimensions: VoiceDimensions) => void;
  onTaskDeleted: (taskId: number) => void;
  onShowTasks: (taskIds: number[]) => void;
  currentTaskId: number | null;
  currentTaskLabel: string | null;
  drawerOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const feedBoxRef = useRef<HTMLDivElement | null>(null);
  const feedSeqRef = useRef(0);
  // The last few exchanges, sent to the classifier as context.
  const historyRef = useRef<HistoryEntry[]>([]);
  // The list being walked: ids, a spoken name for it, the filters that
  // built it, and the last item of it the person was on. Sent with every
  // request — the realtime model keeps none of this itself, and the
  // classifier used to see none of it (so "the first one" and "next" were
  // answered against the whole task list).
  const workingListRef = useRef<number[]>([]);
  const listLabelRef = useRef<string | null>(null);
  const listFiltersRef = useRef<VoiceFilters | null>(null);
  const cursorRef = useRef<number | null>(null);
  // Same staleness problem VoiceAsk's currentTaskIdRef solves — runTool
  // fires from a WebRTC data-channel callback that can outlive several
  // re-renders, so a plain closure over the prop would see whatever task
  // was open when the session started, not whatever's open right now.
  const currentTaskIdRef = useRef(currentTaskId);
  useEffect(() => { currentTaskIdRef.current = currentTaskId; }, [currentTaskId]);
  const currentTaskLabelRef = useRef(currentTaskLabel);
  useEffect(() => { currentTaskLabelRef.current = currentTaskLabel; }, [currentTaskLabel]);
  // Same confirm-then-execute gates as VoiceAsk.tsx, same reasoning —
  // deleting a task and messaging someone outside Task AI both reach
  // past a model's own read of "that sounded like a yes."
  const pendingDeleteRef = useRef<{ id: number; subject: string } | null>(null);
  const pendingNotifyRef = useRef<PendingNotify | null>(null);
  // Voice audit trail (app/lib/voice-audit.ts). One id per live session
  // ties together what the server logs for each tool call with what only
  // this component can see: what the person actually said, what the
  // assistant said back, confirmation outcomes, and transport errors.
  const auditSessionRef = useRef("");
  // What the next realtime response is for — lets the audit tell "assistant
  // read out a Task AI answer" apart from "assistant answered on its own,
  // without ever calling Task AI" (the one that can claim something
  // happened that didn't), and keeps the greeting from being flagged as
  // that. Per-response, so it doesn't depend on event arrival order.
  const followUpPendingRef = useRef(false);
  const greetingPendingRef = useRef(false);
  const responseKindRef = useRef(new Map<string, "direct" | "tool_result" | "greeting">());
  const transcriptByResponseRef = useRef(new Map<string, string>());
  const transcriptionOnRef = useRef(true);
  // Only one realtime response can run at a time. Asking for a second
  // while one is active is an error that silently ate the spoken answer
  // (seen in the audit trail as a stalled session), so a request made
  // while one is running is held and sent when that one finishes.
  const activeSinceRef = useRef(0);
  const wantResponseRef = useRef(false);

  function audit(...events: ClientAuditEvent[]) { reportVoiceAudit(auditSessionRef.current, "live", events); }

  function addFeed(kind: FeedKind, text: string) {
    if (!text.trim()) return;
    feedSeqRef.current += 1;
    const id = `f${feedSeqRef.current}`;
    setFeed(items => [...items, { id, kind, text }].slice(-60));
  }
  // What the person says arrives as a live transcript keyed by the
  // realtime item id: a placeholder appears when speech starts, grows
  // with each partial, and is fixed when the final text arrives.
  function upsertHeard(itemId: string, change: { append?: string; text?: string; done?: boolean }) {
    setFeed(items => {
      const existing = items.find(i => i.id === itemId);
      const base = existing?.text ?? "";
      const text = change.text !== undefined ? change.text : base + (change.append ?? "");
      if (change.done && !text.trim()) return items.filter(i => i.id !== itemId);
      const next: FeedItem = { id: itemId, kind: "heard", text, pending: !change.done };
      return existing ? items.map(i => i.id === itemId ? next : i) : [...items, next].slice(-60);
    });
  }
  function dropHeard(itemId: string) { setFeed(items => items.filter(i => i.id !== itemId)); }

  useEffect(() => {
    const box = feedBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [feed, open, minimized]);

  // Leaving the page (or the component) must never leave the mic live.
  useEffect(() => () => {
    dcRef.current?.close(); pcRef.current?.close();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  function teardown() {
    dcRef.current?.close(); dcRef.current = null;
    pcRef.current?.close(); pcRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    activeSinceRef.current = 0; wantResponseRef.current = false;
  }

  const responseIsActive = () => activeSinceRef.current > 0 && Date.now() - activeSinceRef.current < RESPONSE_STALE_MS;

  // Asks the realtime model to speak next — now if it is idle, otherwise
  // as soon as its current response is done (see handleRealtimeEvent).
  function requestResponse(body?: Record<string, unknown>) {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    if (responseIsActive()) { wantResponseRef.current = true; return; }
    activeSinceRef.current = Date.now();
    dc.send(JSON.stringify(body ? { type: "response.create", response: body } : { type: "response.create" }));
  }

  function sendToolResult(callId: string, payload: unknown) {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") {
      audit({ event: "error", outcome: "failed", spokenAnswer: "Task AI's answer could not be delivered back to the live session (connection was already closed).", detail: { callId } });
      return;
    }
    dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(payload) } }));
    followUpPendingRef.current = true;
    requestResponse();
  }

  // Shows the answer, remembers it for the classifier's context, and
  // hands it to the realtime model to speak.
  function finish(callId: string, answer: string, prefix = "") {
    const spoken = `${prefix}${answer}`.trim();
    addFeed("result", spoken);
    historyRef.current = [...historyRef.current, { role: "assistant" as const, text: spoken }].slice(-12);
    sendToolResult(callId, { spokenAnswer: spoken });
  }

  // Opening a task also moves the place-in-the-list marker, when the task
  // is on the list — "next" counts from there.
  function openTask(taskId: number) {
    onOpenTask(taskId);
    if (workingListRef.current.includes(taskId)) cursorRef.current = taskId;
  }

  // Everything that reaches Task AI goes through here. `prefix` is spoken
  // before the answer (used when a pending confirmation was cancelled).
  async function queryTaskAi(callId: string, utterance: string, prefix: string, body: Record<string, unknown>) {
    const recent = historyRef.current.slice(-6).map(entry => ({ role: entry.role === "you" ? "user" : "assistant", text: entry.text }));
    try {
      const res = await fetch("/api/voice-query", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body, currentTaskId: currentTaskIdRef.current, workingList: workingListRef.current,
          listLabel: listLabelRef.current, listFilters: listFiltersRef.current, cursorTaskId: cursorRef.current,
          history: recent, sessionId: auditSessionRef.current, source: "live",
        }),
      });
      const data = await res.json() as QueryResult;
      if (!res.ok) { finish(callId, data.error || "Sorry, something went wrong.", prefix); return; }
      const answer = data.spokenAnswer || "";

      if (data.mode === "filter" || data.mode === "walk") {
        if (data.filters) onApplyFilters(data.filters);
        if (data.workingListIds) {
          workingListRef.current = data.workingListIds; listLabelRef.current = data.listLabel ?? null;
          listFiltersRef.current = data.filters ?? null; cursorRef.current = null;
        }
        if (data.mode === "walk" && data.openTaskId != null) openTask(data.openTaskId);
      }
      if (data.mode === "briefing" && data.workingListIds) {
        workingListRef.current = data.workingListIds; listLabelRef.current = data.listLabel ?? "your briefing";
        listFiltersRef.current = null; cursorRef.current = null;
        onShowTasks(data.workingListIds);
      }
      // A question or request about one task puts that task on screen, so
      // what is said and what is shown stay on the same task.
      if ((data.mode === "open_task" || data.mode === "answer") && data.openTaskId != null) openTask(data.openTaskId);
      if (data.mode === "navigate" && data.navigateTarget) {
        if (data.navigateTarget === "dictate") {
          // A real full-page navigation leaves this screen entirely and
          // ends the live session — so close the session cleanly first,
          // rather than navigating out from under a live connection.
          addFeed("result", answer);
          audit({ event: "session", mode: "stopped", spokenAnswer: "Left the page to open voice dictation." });
          teardown(); setOpen(false); setStatus("idle");
          onNavigate(data.navigateTarget);
          return;
        }
        onNavigate(data.navigateTarget);
        finish(callId, answer, prefix);
        return;
      }
      if (data.mode === "act") {
        if (data.tasks?.length) data.tasks.forEach(t => onTaskUpdated(t));
        else if (data.task) onTaskUpdated(data.task as VoiceTaskUpdate);
        if (data.nextTaskId != null) openTask(data.nextTaskId);
        else if (data.openTaskId != null) openTask(data.openTaskId);
      }
      if (data.mode === "confirm_delete" && data.pendingDeleteTaskId != null) {
        pendingDeleteRef.current = { id: data.pendingDeleteTaskId, subject: currentTaskLabelRef.current || "this task" };
      }
      if (data.mode === "confirm_notify" && data.pendingNotify) pendingNotifyRef.current = data.pendingNotify;
      if (data.mode === "created" && data.task && data.dimensions) onTaskCreated(data.task as VoiceCreatedTask, data.dimensions);
      if (data.mode === "next" && data.nextTaskId != null) openTask(data.nextTaskId);

      finish(callId, answer, prefix);
    } catch {
      audit({ event: "error", outcome: "failed", utterance, spokenAnswer: "Could not reach Task AI — the request failed before an answer came back.", detail: { currentTaskId: currentTaskIdRef.current } });
      finish(callId, "Could not reach Task AI — check your connection.", prefix);
    }
  }

  // The realtime session's main tool — called with whatever the person
  // just said. Same dispatch shape as VoiceAsk.ask(): resolve a pending
  // delete/notify confirmation first if one's outstanding, otherwise
  // classify the utterance fresh. Every branch ends by handing
  // spokenAnswer back as the tool's output instead of calling a TTS
  // route — the realtime model speaks it itself.
  async function runTool(callId: string, utterance: string) {
    let trimmed = utterance.trim();
    if (!trimmed) {
      audit({ event: "error", outcome: "not_done", spokenAnswer: "The assistant called Task AI with an empty request, so nothing was done.", detail: { callId } });
      sendToolResult(callId, { spokenAnswer: "" });
      return;
    }
    addFeed("asked", trimmed);
    historyRef.current = [...historyRef.current, { role: "you" as const, text: trimmed }].slice(-12);
    let prefix = "";

    const pending = pendingDeleteRef.current ? { kind: "delete" as const, ...pendingDeleteRef.current }
      : pendingNotifyRef.current ? { kind: "notify" as const, ...pendingNotifyRef.current } : null;
    if (pending) {
      const reply = interpretConfirmReply(trimmed);
      pendingDeleteRef.current = null; pendingNotifyRef.current = null;
      const taskId = pending.kind === "delete" ? pending.id : pending.taskId;
      if (reply.decision === "yes" && pending.kind === "delete") {
        try {
          const res = await fetch("/api/voice-query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmDeleteTaskId: pending.id, sessionId: auditSessionRef.current, source: "live" }) });
          const data = await res.json() as QueryResult;
          const answer = !res.ok ? (data.error || "Could not delete that") : (data.spokenAnswer || "");
          if (res.ok && data.mode === "deleted" && data.deletedTaskId != null) onTaskDeleted(data.deletedTaskId);
          finish(callId, answer);
        } catch {
          audit({ event: "error", outcome: "failed", utterance: trimmed, spokenAnswer: "Could not reach Task AI to confirm the delete.", detail: { taskId } });
          finish(callId, "Could not reach Task AI — check your connection.");
        }
        return;
      }
      if (reply.decision === "yes" && pending.kind === "notify") {
        try {
          const res = await fetch("/api/tasks/notify", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskId: pending.taskId, toEmails: [pending.toEmail], channel: pending.channel, message: pending.message }),
          });
          const data = await res.json() as { sent?: boolean; results?: Array<{ reason?: string }>; error?: string };
          const answer = !res.ok ? (data.error || "Could not send that.")
            : data.sent ? `Sent to ${pending.toName}.`
            : `Could not send — ${data.results?.[0]?.reason || "please try again."}`;
          audit({ event: "confirmation", mode: "notify", outcome: res.ok && data.sent ? "sent" : "failed", utterance: trimmed, spokenAnswer: answer, taskIds: [pending.taskId], detail: { to: pending.toName, channel: pending.channel, message: pending.message } });
          finish(callId, answer);
        } catch {
          audit({ event: "confirmation", mode: "notify", outcome: "failed", utterance: trimmed, spokenAnswer: "Could not reach Task AI to send the notification.", taskIds: [pending.taskId], detail: { to: pending.toName, channel: pending.channel, message: pending.message } });
          finish(callId, "Could not reach Task AI — check your connection.");
        }
        return;
      }
      // Anything but a clean "yes" cancels what was waiting for it. If the
      // reply also carried something to do ("No, send it to Maya instead",
      // or a different request altogether) that is now handled as a new
      // request, instead of being thrown away as before — which cost a
      // live session its flow. Nothing is ever sent or deleted on a reply
      // that wasn't an unambiguous yes.
      const cancelled = pending.kind === "delete" ? "I won't delete it." : "I won't send it.";
      audit({
        event: "confirmation", mode: pending.kind, outcome: "declined", utterance: trimmed, taskIds: [taskId],
        spokenAnswer: cancelled, detail: pending.kind === "notify"
          ? { to: pending.toName, channel: pending.channel, message: pending.message, reply: reply.decision, handledAsNewRequest: reply.newRequest !== null }
          : { reply: reply.decision, handledAsNewRequest: reply.newRequest !== null },
      });
      if (reply.newRequest === null) { finish(callId, pending.kind === "delete" ? "Okay, keeping it." : "Okay, not sending it."); return; }
      prefix = `Okay, ${cancelled} `;
      trimmed = reply.newRequest;
    }

    await queryTaskAi(callId, trimmed, prefix, { transcript: trimmed });
  }

  // "Next" without going through the classifier at all — the dedicated
  // next_task tool. The server walks the list deterministically.
  async function runNext(callId: string) {
    addFeed("asked", "Next task");
    historyRef.current = [...historyRef.current, { role: "you" as const, text: "next task" }].slice(-12);
    await queryTaskAi(callId, "next task", "", { action: "next" });
  }

  // Everything below handles the realtime session's own events. Written
  // against shapes confirmed in OpenAI's current docs where possible and
  // deliberately tolerant elsewhere (the assistant-transcript event has
  // gone by more than one name), since a missed event here only costs a
  // line in the audit trail — it must never break the conversation.
  function handleRealtimeEvent(msg: RealtimeEvent) {
    if (msg.type === "response.function_call_arguments.done" && msg.call_id && msg.arguments !== undefined) {
      if (msg.name === "next_task") { void runNext(msg.call_id); return; }
      if (msg.name !== "ask_task_ai") {
        audit({ event: "error", outcome: "failed", spokenAnswer: `The assistant tried to call an unknown tool (${msg.name}).`, detail: { tool: msg.name } });
        return;
      }
      let utterance = "";
      try { utterance = (JSON.parse(msg.arguments) as { utterance?: string }).utterance || ""; } catch { /* leave blank */ }
      void runTool(msg.call_id, utterance);
    } else if (msg.type === "input_audio_buffer.speech_started" && msg.item_id && transcriptionOnRef.current) {
      upsertHeard(msg.item_id, {});
    } else if (msg.type === "conversation.item.input_audio_transcription.delta" && msg.item_id && msg.delta) {
      upsertHeard(msg.item_id, { append: msg.delta });
    } else if (msg.type === "conversation.item.input_audio_transcription.completed") {
      const text = msg.transcript?.trim() || "";
      if (msg.item_id) upsertHeard(msg.item_id, { text, done: true });
      if (text) audit({ event: "heard", utterance: text });
    } else if (msg.type === "conversation.item.input_audio_transcription.failed") {
      if (msg.item_id) dropHeard(msg.item_id);
      audit({ event: "error", outcome: "failed", spokenAnswer: "Transcribing what the person said failed (the assistant may still have heard it).", detail: { message: msg.error?.message } });
    } else if (msg.type === "response.created" && msg.response?.id) {
      activeSinceRef.current = Date.now();
      responseKindRef.current.set(msg.response.id, greetingPendingRef.current ? "greeting" : followUpPendingRef.current ? "tool_result" : "direct");
      greetingPendingRef.current = false; followUpPendingRef.current = false;
    } else if ((msg.type === "response.output_audio_transcript.done" || msg.type === "response.audio_transcript.done") && msg.response_id && msg.transcript) {
      transcriptByResponseRef.current.set(msg.response_id, msg.transcript);
    } else if (msg.type === "response.done" && msg.response?.id) {
      activeSinceRef.current = 0;
      const response = msg.response, id = response.id as string;
      const kindBase = responseKindRef.current.get(id) ?? "direct";
      responseKindRef.current.delete(id);
      const fromOutput = (response.output || []).flatMap(item => item.content || []).map(part => part.transcript || "").filter(Boolean).join(" ").trim();
      const transcript = fromOutput || transcriptByResponseRef.current.get(id) || "";
      transcriptByResponseRef.current.delete(id);
      const calledTool = (response.output || []).some(item => item.type === "function_call");
      if (response.status === "failed") {
        audit({ event: "error", outcome: "failed", spokenAnswer: `The live assistant's response failed${response.status_details?.error?.message ? `: ${response.status_details.error.message}` : "."}` });
      }
      if (transcript) {
        audit({ event: "said", spokenAnswer: transcript, detail: { kind: calledTool ? "with_tool_call" : kindBase } });
        // What Task AI answered is already shown as the result; only what
        // the assistant said on its own needs its own line.
        if (calledTool || kindBase !== "tool_result") addFeed("said", transcript);
      }
      // A tool result that arrived while this response was still running
      // was held — ask for it to be spoken now.
      if (wantResponseRef.current) { wantResponseRef.current = false; requestResponse(); }
    } else if (msg.type === "error") {
      audit({ event: "error", outcome: "failed", spokenAnswer: `Realtime session error: ${msg.error?.message || "unknown"}`, detail: { type: msg.error?.type, code: msg.error?.code } });
    }
  }

  async function start() {
    setError(""); setFeed([]); setStatus("connecting");
    historyRef.current = []; workingListRef.current = []; listLabelRef.current = null; listFiltersRef.current = null; cursorRef.current = null;
    pendingDeleteRef.current = null; pendingNotifyRef.current = null;
    auditSessionRef.current = newVoiceSessionId();
    followUpPendingRef.current = false; greetingPendingRef.current = false;
    responseKindRef.current.clear(); transcriptByResponseRef.current.clear();
    activeSinceRef.current = 0; wantResponseRef.current = false;
    try {
      const sessionRes = await fetch("/api/voice-live/session", { method: "POST" });
      const session = await sessionRes.json() as { clientSecret?: string; model?: string; transcription?: boolean; error?: string };
      if (!session.clientSecret) throw new Error(session.error || "Could not start a live session");
      transcriptionOnRef.current = session.transcription !== false;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.ontrack = event => { if (audioRef.current) audioRef.current.srcObject = event.streams[0]; };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      // The assistant opens the conversation itself — no second click on
      // the mic. Marked as a greeting so the audit trail doesn't flag it
      // as an answer given without asking Task AI.
      dc.onopen = () => {
        greetingPendingRef.current = true;
        requestResponse({ instructions: `Greet the person by saying exactly this and nothing else: "${GREETING}"` });
      };
      dc.onmessage = event => {
        let msg: RealtimeEvent = {};
        try { msg = JSON.parse(event.data); } catch { return; }
        handleRealtimeEvent(msg);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          audit({ event: "session", mode: "connection_lost", outcome: "failed", spokenAnswer: "The live connection to OpenAI dropped." });
          teardown(); setStatus("error"); setError("The live connection dropped — tap the microphone to start again.");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // No ?model= or other query params — the model is already bound
      // to the ephemeral client secret at mint time.
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { authorization: `Bearer ${session.clientSecret}`, "content-type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdpRes.ok) throw new Error(`Realtime connection failed (${sdpRes.status})`);
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

      setStatus("connected");
      audit({ event: "session", mode: "started", detail: { model: session.model } });
    } catch (err) {
      teardown();
      setStatus("error");
      const message = err instanceof DOMException ? describeMicError(err) : err instanceof Error ? err.message : "Could not start the live session.";
      setError(message);
      audit({ event: "session", mode: "start_failed", outcome: "failed", spokenAnswer: message });
    }
  }

  function closePanel() {
    if (pcRef.current) audit({ event: "session", mode: "stopped" });
    teardown();
    setOpen(false); setMinimized(false); setStatus("idle"); setError("");
  }

  // One click opens the panel AND starts the session — mic on, greeting
  // spoken — instead of a second click on a microphone button. The click
  // itself is the user gesture the browser needs for mic access and audio.
  function toggleAssistant() {
    if (open) { closePanel(); return; }
    setOpen(true); setMinimized(false);
    void start();
  }

  // Docked bottom-right, out of the way of the task list; when the task
  // drawer is open it docks to the drawer's left instead so the open task
  // stays fully visible.
  const dock = drawerOpen ? "left-6 min-[621px]:left-auto min-[621px]:right-[calc(var(--drawer-w)_+_1.5rem)]" : "right-6";
  const lastLine = feed.length ? feed[feed.length - 1].text : "";
  const statusText = status === "connecting" ? "Connecting…" : status === "connected" ? "Listening — just talk" : status === "error" ? "Stopped" : "Not listening";

  return (
    <>
      <button
        type="button" onClick={toggleAssistant}
        className={
          drawerOpen && !open
            ? "fixed z-30 bottom-6 left-6 min-[621px]:left-auto min-[621px]:right-[calc(var(--drawer-w)_+_1.5rem)] h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3] shadow-[0_8px_30px_rgba(16,47,89,0.2)]"
            : "relative z-30 h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3]"
        }
      >
        🔴 Live Voice Assistant
      </button>
      {/* Always rendered (even while minimised) — it is what plays the assistant's voice. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live two-way voice audio, nothing to caption */}
      <audio ref={audioRef} autoPlay />
      {/* Rendered into <body>, not here: this component sits inside the toolbar's .actions
          container, whose global rules (".actions button", ".actions button:first-child:after")
          restyle every button in the panel and stamp "Paste notes" onto the first one. */}
      {open && createPortal(<>
      {minimized && (
        <div className={`fixed bottom-6 z-50 flex items-center gap-2 max-w-[calc(100%-3rem)] bg-white rounded-full shadow-[0_8px_30px_rgba(16,47,89,0.2)] border border-[#e3e8ee] pl-3 pr-1.5 py-1.5 ${dock}`}>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status === "connected" ? "bg-[#25784b] animate-pulse" : status === "error" ? "bg-[#a84235]" : "bg-[#c96539]"}`} aria-hidden="true" />
          <button type="button" onClick={() => setMinimized(false)} className="text-left min-w-0" aria-label="Expand the Live Voice Assistant">
            <span className="block text-xs font-bold text-[#102f59]">Live · {statusText}</span>
            {lastLine && <span className="block text-[11px] text-[#697181] truncate max-w-[14rem]">{lastLine}</span>}
          </button>
          <button type="button" onClick={() => setMinimized(false)} className="h-7 w-7 shrink-0 rounded-full text-[#697181] hover:bg-[#f1f3f7]" aria-label="Expand">▴</button>
          <button type="button" onClick={closePanel} className="h-7 w-7 shrink-0 rounded-full text-[#697181] hover:bg-[#f1f3f7]" aria-label="Stop and close">×</button>
        </div>
      )}
      {!minimized && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onKeyDown is Escape-to-close, the keyboard-accessible equivalent of the × button right below
        <div
          role="dialog" aria-label="Live Voice Assistant"
          className={`fixed bottom-6 z-50 w-[min(19rem,calc(100%-3rem))] bg-white rounded-2xl shadow-[0_8px_30px_rgba(16,47,89,0.2)] border border-[#e3e8ee] flex flex-col p-3 ${dock}`}
          onKeyDown={e => { if (e.key === "Escape") closePanel(); }}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status === "connected" ? "bg-[#25784b] animate-pulse" : status === "error" ? "bg-[#a84235]" : "bg-[#c96539]"}`} aria-hidden="true" />
              <h2 className="text-sm font-bold text-[#102f59] truncate">Live Voice Assistant</h2>
            </div>
            <div className="flex items-center shrink-0">
              <button type="button" onClick={() => setMinimized(true)} className="h-7 w-7 rounded-full text-[#697181] hover:bg-[#f1f3f7]" aria-label="Minimise — keep listening, get out of the way" title="Minimise (keeps listening)">▾</button>
              <button type="button" onClick={closePanel} className="h-7 w-7 rounded-full text-[#697181] hover:bg-[#f1f3f7] text-lg leading-none" aria-label="Stop and close" title="Stop and close">×</button>
            </div>
          </div>

          {currentTaskLabel && (
            <div className="text-[11px] font-semibold text-[#173f76] bg-[#eef3fa] rounded-md px-2 py-1 mb-2 truncate" title={currentTaskLabel}>
              🗂️ On screen: {currentTaskLabel}
            </div>
          )}

          <div ref={feedBoxRef} className="overflow-y-auto max-h-[32vh] min-h-[3.5rem] mb-2 flex flex-col gap-1.5 pr-0.5" aria-live="polite">
            {feed.length === 0 && <p className="text-xs text-[#8b929d]">{status === "connecting" ? "Connecting…" : `Just talk — interrupt whenever you like. Try "my overdue tasks," "check off call the client," or "notify the owner."`}</p>}
            {feed.map((item, i) => {
              if (item.kind === "asked") {
                // Skip the echo when Task AI was asked exactly what was heard.
                const before = feed[i - 1];
                if (before?.kind === "heard" && normalize(before.text) === normalize(item.text)) return null;
                return <div key={item.id} className="self-end max-w-[90%] text-[11px] italic text-[#8b929d]">asked Task AI: “{item.text}”</div>;
              }
              if (item.kind === "heard") {
                return (
                  <div key={item.id} className={`self-end max-w-[88%] text-[13px] leading-snug rounded-lg px-2.5 py-1.5 bg-[#173f76] text-white ${item.pending ? "opacity-80" : ""}`}>
                    {item.text || <span className="animate-pulse">…</span>}
                  </div>
                );
              }
              return (
                <div key={item.id} className={`self-start max-w-[92%] text-[13px] leading-snug rounded-lg px-2.5 py-1.5 ${item.kind === "result" ? "bg-[#f1f3f7] text-[#202735]" : "bg-[#eef3fa] text-[#102f59]"}`}>
                  {item.text}
                </div>
              );
            })}
          </div>

          {error && <div className="text-xs text-[#a84235] mb-2">{error}</div>}

          <div className="flex items-center gap-2">
            {status === "connected" || status === "connecting" ? (
              <button type="button" onClick={closePanel} className="h-8 w-8 shrink-0 rounded-full bg-[#c96539] text-white text-xs" aria-label="Stop">■</button>
            ) : (
              <button type="button" onClick={() => void start()} className="h-8 w-8 shrink-0 rounded-full bg-[#173f76] text-white text-sm" aria-label="Start again">🎙️</button>
            )}
            <div className="text-[11px] text-[#8b929d]">{status === "idle" || status === "error" ? "Tap the mic to start again" : statusText}</div>
          </div>
        </div>
      )}
      </>, document.body)}
    </>
  );
}

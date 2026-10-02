"use client";
import { useEffect, useRef, useState } from "react";
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
// The realtime session itself has exactly one tool it can call —
// ask_task_ai(utterance), defined server-side at session-mint time — so
// all the actual thinking (classify, permission checks, DB reads/writes)
// stays in app/api/voice-query/route.ts, completely unchanged and shared
// with VoiceAsk. This component's runTool() below is deliberately the
// same dispatch shape as VoiceAsk's ask(): same request body, same
// mode-by-mode handling of the response, same onX screen-sync callbacks,
// same pendingDelete/pendingNotify confirm-then-execute gates for the two
// actions that reach outside Task AI itself (deleting a task, messaging
// someone). The only real difference is HOW the answer reaches the
// person: VoiceAsk calls Deepgram TTS and plays it back itself; here, the
// answer is handed back as the tool's own output and OpenAI's realtime
// model speaks it as part of the live conversation.

type Status = "idle" | "connecting" | "connected" | "error";
type LogEntry = { role: "you" | "assistant"; text: string };

function describeMicError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  const hint =
    name === "NotAllowedError" ? "permission was denied — check your browser and system microphone settings." :
    name === "NotFoundError" ? "no microphone was found." :
    name === "NotReadableError" ? "the microphone is in use by another app." :
    "an unexpected error occurred.";
  return name ? `Microphone error (${name}): ${hint}` : "Microphone access failed.";
}

function isAffirmative(text: string) { return /^\s*(yes|yeah|yep|yup|confirm(ed)?|do it|go ahead|correct|sure|please do)\b/i.test(text); }
function isNegative(text: string) { return /^\s*(no|nope|never\s?mind|cancel|stop|don'?t)\b/i.test(text); }

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
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const logRef = useRef<LogEntry[]>([]);
  const workingListRef = useRef<number[]>([]);
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
  // True between handing a tool result back and the model's spoken
  // follow-up to it starting — lets the audit tell "assistant read out a
  // Task AI answer" apart from "assistant answered on its own, without
  // ever calling Task AI" (the one that can claim something happened
  // that didn't). Per-response, not per-transcript, so it doesn't depend
  // on the order the realtime events happen to arrive in.
  const followUpPendingRef = useRef(false);
  const responseKindRef = useRef(new Map<string, "direct" | "tool_result">());
  const transcriptByResponseRef = useRef(new Map<string, string>());

  function appendLog(entry: LogEntry) { setLog(l => [...l, entry]); logRef.current = [...logRef.current, entry]; }
  function audit(...events: ClientAuditEvent[]) { reportVoiceAudit(auditSessionRef.current, "live", events); }

  function teardown() {
    dcRef.current?.close(); dcRef.current = null;
    pcRef.current?.close(); pcRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
  }

  function sendToolResult(callId: string, payload: unknown) {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") {
      audit({ event: "error", outcome: "failed", spokenAnswer: "Task AI's answer could not be delivered back to the live session (connection was already closed).", detail: { callId } });
      return;
    }
    followUpPendingRef.current = true;
    dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(payload) } }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  // The realtime session's one and only tool — called with whatever the
  // person just said. Same dispatch shape as VoiceAsk.ask(): resolve a
  // pending delete/notify confirmation first if one's outstanding,
  // otherwise classify the utterance fresh. Every branch ends by handing
  // spokenAnswer back as the tool's output instead of calling a TTS
  // route — the realtime model speaks it itself.
  async function runTool(callId: string, utterance: string) {
    const trimmed = utterance.trim();
    if (!trimmed) {
      audit({ event: "error", outcome: "not_done", spokenAnswer: "The assistant called Task AI with an empty request, so nothing was done.", detail: { callId } });
      sendToolResult(callId, { spokenAnswer: "" });
      return;
    }
    appendLog({ role: "you", text: trimmed });

    if (pendingDeleteRef.current) {
      const pending = pendingDeleteRef.current;
      pendingDeleteRef.current = null;
      if (isAffirmative(trimmed)) {
        try {
          const res = await fetch("/api/voice-query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmDeleteTaskId: pending.id, sessionId: auditSessionRef.current, source: "live" }) });
          const data = await res.json() as { mode?: string; deletedTaskId?: number; spokenAnswer?: string; error?: string };
          const answer = !res.ok ? (data.error || "Could not delete that") : (data.spokenAnswer || "");
          appendLog({ role: "assistant", text: answer });
          if (res.ok && data.mode === "deleted" && data.deletedTaskId != null) onTaskDeleted(data.deletedTaskId);
          sendToolResult(callId, { spokenAnswer: answer });
        } catch {
          audit({ event: "error", outcome: "failed", utterance: trimmed, spokenAnswer: "Could not reach Task AI to confirm the delete.", detail: { taskId: pending.id } });
          sendToolResult(callId, { spokenAnswer: "Could not reach Task AI — check your connection." });
        }
        return;
      }
      const answer = isNegative(trimmed) ? "Okay, keeping it." : "I didn't catch a yes or no, so I'll leave it as is.";
      appendLog({ role: "assistant", text: answer });
      audit({ event: "confirmation", mode: "delete", outcome: "declined", utterance: trimmed, spokenAnswer: answer, taskIds: [pending.id], detail: { reply: isNegative(trimmed) ? "no" : "unclear" } });
      sendToolResult(callId, { spokenAnswer: answer });
      return;
    }

    if (pendingNotifyRef.current) {
      const pending = pendingNotifyRef.current;
      pendingNotifyRef.current = null;
      if (isAffirmative(trimmed)) {
        try {
          const res = await fetch("/api/tasks/notify", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskId: pending.taskId, toEmails: [pending.toEmail], channel: pending.channel, message: pending.message }),
          });
          const data = await res.json() as { sent?: boolean; results?: Array<{ reason?: string }>; error?: string };
          const answer = !res.ok ? (data.error || "Could not send that.")
            : data.sent ? `Sent to ${pending.toName}.`
            : `Could not send — ${data.results?.[0]?.reason || "please try again."}`;
          appendLog({ role: "assistant", text: answer });
          audit({ event: "confirmation", mode: "notify", outcome: res.ok && data.sent ? "sent" : "failed", utterance: trimmed, spokenAnswer: answer, taskIds: [pending.taskId], detail: { to: pending.toName, channel: pending.channel, message: pending.message } });
          sendToolResult(callId, { spokenAnswer: answer });
        } catch {
          audit({ event: "confirmation", mode: "notify", outcome: "failed", utterance: trimmed, spokenAnswer: "Could not reach Task AI to send the notification.", taskIds: [pending.taskId], detail: { to: pending.toName, channel: pending.channel, message: pending.message } });
          sendToolResult(callId, { spokenAnswer: "Could not reach Task AI — check your connection." });
        }
        return;
      }
      const answer = isNegative(trimmed) ? "Okay, not sending it." : "I didn't catch a yes or no, so I won't send it.";
      appendLog({ role: "assistant", text: answer });
      audit({ event: "confirmation", mode: "notify", outcome: "declined", utterance: trimmed, spokenAnswer: answer, taskIds: [pending.taskId], detail: { to: pending.toName, channel: pending.channel, message: pending.message, reply: isNegative(trimmed) ? "no" : "unclear" } });
      sendToolResult(callId, { spokenAnswer: answer });
      return;
    }

    const recentHistory = logRef.current.slice(-6).map(entry => ({ role: entry.role === "you" ? "user" : "assistant", text: entry.text }));
    try {
      const res = await fetch("/api/voice-query", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: trimmed, currentTaskId: currentTaskIdRef.current, workingList: workingListRef.current, history: recentHistory, sessionId: auditSessionRef.current, source: "live" }),
      });
      const data = await res.json() as {
        mode?: string; filters?: VoiceFilters | null; navigateTarget?: VoiceNavigateTarget | null;
        workingListIds?: number[]; task?: VoiceTaskUpdate | VoiceCreatedTask | null; tasks?: VoiceTaskUpdate[] | null;
        nextTaskId?: number | null; openTaskId?: number | null;
        dimensions?: VoiceDimensions; pendingDeleteTaskId?: number | null; pendingNotify?: PendingNotify | null;
        spokenAnswer?: string; error?: string;
      };
      if (!res.ok) { appendLog({ role: "assistant", text: data.error || "Could not process that" }); sendToolResult(callId, { spokenAnswer: data.error || "Sorry, something went wrong." }); return; }
      const answer = data.spokenAnswer || "";
      appendLog({ role: "assistant", text: answer });

      if (data.mode === "filter" || data.mode === "walk") {
        if (data.filters) onApplyFilters(data.filters);
        if (data.workingListIds) workingListRef.current = data.workingListIds;
        if (data.mode === "walk" && data.openTaskId != null) onOpenTask(data.openTaskId);
      }
      if (data.mode === "briefing" && data.workingListIds) {
        workingListRef.current = data.workingListIds;
        onShowTasks(data.workingListIds);
      }
      if (data.mode === "navigate" && data.navigateTarget) {
        onNavigate(data.navigateTarget);
        sendToolResult(callId, { spokenAnswer: answer });
        // A real full-page navigation (dictate) leaves this screen
        // entirely — tear the live session down rather than let it
        // linger on a page about to unload.
        if (data.navigateTarget === "dictate") { teardown(); setOpen(false); setStatus("idle"); }
        return;
      }
      if (data.mode === "act") {
        if (data.tasks?.length) data.tasks.forEach(t => onTaskUpdated(t));
        else if (data.task) onTaskUpdated(data.task as VoiceTaskUpdate);
        if (data.nextTaskId != null) onOpenTask(data.nextTaskId);
      }
      if (data.mode === "confirm_delete" && data.pendingDeleteTaskId != null) {
        pendingDeleteRef.current = { id: data.pendingDeleteTaskId, subject: currentTaskLabelRef.current || "this task" };
      }
      if (data.mode === "confirm_notify" && data.pendingNotify) pendingNotifyRef.current = data.pendingNotify;
      if (data.mode === "created" && data.task && data.dimensions) onTaskCreated(data.task as VoiceCreatedTask, data.dimensions);
      if (data.mode === "next" && data.nextTaskId != null) onOpenTask(data.nextTaskId);

      sendToolResult(callId, { spokenAnswer: answer });
    } catch {
      audit({ event: "error", outcome: "failed", utterance: trimmed, spokenAnswer: "Could not reach Task AI — the request failed before an answer came back.", detail: { currentTaskId: currentTaskIdRef.current } });
      sendToolResult(callId, { spokenAnswer: "Could not reach Task AI — check your connection." });
    }
  }

  // Everything below handles the realtime session's own events. Written
  // against shapes confirmed in OpenAI's current docs where possible and
  // deliberately tolerant elsewhere (the assistant-transcript event has
  // gone by more than one name), since a missed event here only costs a
  // line in the audit trail — it must never break the conversation.
  function handleRealtimeEvent(msg: {
    type?: string; call_id?: string; name?: string; arguments?: string; transcript?: string; response_id?: string;
    response?: { id?: string; status?: string; status_details?: { error?: { message?: string } }; output?: Array<{ type?: string; content?: Array<{ transcript?: string; text?: string }> }> };
    error?: { message?: string; type?: string; code?: string | null };
  }) {
    if (msg.type === "response.function_call_arguments.done" && msg.call_id && msg.arguments !== undefined) {
      if (msg.name !== "ask_task_ai") {
        audit({ event: "error", outcome: "failed", spokenAnswer: `The assistant tried to call an unknown tool (${msg.name}).`, detail: { tool: msg.name } });
        return;
      }
      let utterance = "";
      try { utterance = (JSON.parse(msg.arguments) as { utterance?: string }).utterance || ""; } catch { /* leave blank */ }
      void runTool(msg.call_id, utterance);
    } else if (msg.type === "conversation.item.input_audio_transcription.completed" && msg.transcript?.trim()) {
      audit({ event: "heard", utterance: msg.transcript.trim() });
    } else if (msg.type === "conversation.item.input_audio_transcription.failed") {
      audit({ event: "error", outcome: "failed", spokenAnswer: "Transcribing what the person said failed (the assistant may still have heard it).", detail: { message: msg.error?.message } });
    } else if (msg.type === "response.created" && msg.response?.id) {
      responseKindRef.current.set(msg.response.id, followUpPendingRef.current ? "tool_result" : "direct");
      followUpPendingRef.current = false;
    } else if ((msg.type === "response.output_audio_transcript.done" || msg.type === "response.audio_transcript.done") && msg.response_id && msg.transcript) {
      transcriptByResponseRef.current.set(msg.response_id, msg.transcript);
    } else if (msg.type === "response.done" && msg.response?.id) {
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
      if (transcript) audit({ event: "said", spokenAnswer: transcript, detail: { kind: calledTool ? "with_tool_call" : kindBase } });
    } else if (msg.type === "error") {
      audit({ event: "error", outcome: "failed", spokenAnswer: `Realtime session error: ${msg.error?.message || "unknown"}`, detail: { type: msg.error?.type, code: msg.error?.code } });
    }
  }

  async function start() {
    setError(""); setLog([]); logRef.current = []; setStatus("connecting");
    auditSessionRef.current = newVoiceSessionId();
    followUpPendingRef.current = false; responseKindRef.current.clear(); transcriptByResponseRef.current.clear();
    try {
      const sessionRes = await fetch("/api/voice-live/session", { method: "POST" });
      const session = await sessionRes.json() as { clientSecret?: string; model?: string; error?: string };
      if (!session.clientSecret) throw new Error(session.error || "Could not start a live session");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.ontrack = event => { if (audioRef.current) audioRef.current.srcObject = event.streams[0]; };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = event => {
        let msg: Parameters<typeof handleRealtimeEvent>[0] = {};
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
    setOpen(false); setStatus("idle"); setError("");
  }

  return (
    <>
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className={
          drawerOpen && !open
            ? "fixed z-30 bottom-6 left-6 min-[621px]:left-auto min-[621px]:right-[calc(var(--drawer-w)_+_1.5rem)] h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3] shadow-[0_8px_30px_rgba(16,47,89,0.2)]"
            : "relative z-30 h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3]"
        }
      >
        🔴 Live Voice Assistant
      </button>
      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onKeyDown is Escape-to-close, the keyboard-accessible equivalent of the × button right below
        <div
          role="dialog" aria-label="Live Voice Assistant"
          className={`fixed bottom-6 z-50 w-[calc(100%-3rem)] max-w-sm bg-white rounded-2xl shadow-[0_8px_30px_rgba(16,47,89,0.2)] border border-[#e3e8ee] flex flex-col p-5 max-h-[70vh] ${drawerOpen ? "left-6 min-[621px]:left-auto min-[621px]:right-[calc(var(--drawer-w)_+_1.5rem)]" : "left-6 min-[621px]:left-[270px]"}`}
          onKeyDown={e => { if (e.key === "Escape") closePanel(); }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-[#102f59]">Live Voice Assistant</h2>
            <button type="button" onClick={closePanel} className="text-[#697181] text-xl leading-none">×</button>
          </div>

          {currentTaskLabel && (
            <div className="text-xs font-semibold text-[#173f76] bg-[#eef3fa] rounded-lg px-3 py-2 mb-3 truncate" title={currentTaskLabel}>
              🗂️ Talking about: {currentTaskLabel}
            </div>
          )}

          <div className="flex-1 overflow-y-auto mb-3 flex flex-col gap-2 min-h-[80px]">
            {log.length === 0 && <p className="text-sm text-[#8b929d]">{`True voice-to-voice — just start talking, interrupt whenever you like. Try "Give me my morning briefing," "Check off call the client," or "Notify the owner of this task."`}</p>}
            {log.map((turn, i) => (
              <div key={i} className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${turn.role === "you" ? "self-end bg-[#173f76] text-white" : "self-start bg-[#f1f3f7] text-[#202735]"}`}>
                {turn.text}
              </div>
            ))}
          </div>

          {error && <div className="text-xs text-[#a84235] mb-2">{error}</div>}

          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live two-way voice audio, nothing to caption */}
          <audio ref={audioRef} autoPlay />

          <div className="flex items-center gap-2">
            {status === "connected" ? (
              <button type="button" onClick={closePanel} className="h-10 w-10 shrink-0 rounded-full bg-[#c96539] text-white" aria-label="Stop">■</button>
            ) : (
              <button type="button" onClick={() => void start()} disabled={status === "connecting"} className="h-10 w-10 shrink-0 rounded-full bg-[#173f76] text-white disabled:opacity-50" aria-label="Start talking">🎙️</button>
            )}
            <div className="text-xs text-[#8b929d]">
              {status === "connecting" && "Connecting…"}
              {status === "connected" && "● Live — just talk, interrupt any time"}
              {status === "idle" && "Tap to start talking"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

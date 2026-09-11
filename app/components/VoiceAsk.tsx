"use client";
import { useEffect, useRef, useState } from "react";
import { splitIntoSpeechChunks } from "../lib/speech-chunks";

// The lightweight alternative to a full conversational voice agent — see
// app/api/voice-query/route.ts for the reasoning. Reuses the exact mic/
// WebSocket/TTS plumbing already proven in app/dictate/DictateClient.tsx
// (same Deepgram token/transcription/speak routes), just pointed at a
// different backend call: instead of "extract a task from this text",
// "understand this question against the tasks I can currently see, and
// either filter the screen, answer it out loud, or open a screen."
//
// Each utterance is independent — there's no open session remembering
// what you asked a moment ago. That's the real tradeoff against a true
// voice agent, acceptable for single-shot commands like "what's due this
// week" and revisit only if genuine back-and-forth turns out to matter.
// What IS continuous is listening itself: once you start by voice, it
// keeps re-listening after each answer until you close the panel —
// confirmed live 2026-09-04 that clicking the mic for every single
// question was the actual friction, not the lack of multi-turn memory.

export type VoiceFilters = {
  owner: string | null; mineOnly: boolean; myRole: "collaborator" | "recipient" | null;
  project: string | null; topic: string | null; recurringMeeting: string | null;
  account: string | null; opportunity: string | null; source: string | null;
  priority: "Low" | "Medium" | "High" | null; dueWithin: "week" | "overdue" | null;
  createdWithin: "today" | null; closedWithin: "today" | null; status: string | null;
  // Both were already sent by the server and already read by
  // TaskApp.js's applyVoiceFilters — just missing from this type
  // annotation until now.
  textContains: string | null; isNew: boolean; hasUnseenUpdate: boolean;
};
export type VoiceNavigateTarget = "dictate" | "new_task" | "paste_minutes";
// What an "act" response hands back — every field any voice-driven
// change could have touched (subject, description, project, topic,
// coworkers/recipients, due, status+closedAt together, priority,
// owner, or updates), so the caller can merge this straight into its
// task state without a full refetch.
export type VoiceTaskUpdate = {
  id: number; subject: string; description: string; owner: string; collaborators: string[]; recipients: string[];
  due: string; status: string; priority: string; project: string; topic: string; closedAt: string | null; updates: Array<{ text: string; at: string; by?: string }>;
};
// A brand-new task voice created directly from a spoken description
// (mode "create_task") — the full row, same shape GET /api/tasks
// returns, so the caller can just prepend it to its task list.
export type VoiceCreatedTask = Record<string, unknown> & { id: number; subject: string };
export type VoiceDimensions = { project: string[]; meeting: string[]; topic: string[]; person: string[] };
type Turn = { role: "user" | "assistant"; text: string };
type Status = "idle" | "connecting" | "recording" | "processing" | "speaking" | "error";

function pickMimeType() {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}
function describeMicError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  const hint =
    name === "NotAllowedError" ? "permission was denied — check your browser and system microphone settings." :
    name === "NotFoundError" ? "no microphone was found." :
    name === "NotReadableError" ? "the microphone is in use by another app." :
    "an unexpected error occurred.";
  return name ? `Microphone error (${name}): ${hint}` : "Microphone access failed.";
}


export default function VoiceAsk({ onApplyFilters, onNavigate, onTaskUpdated, onOpenTask, onTaskCreated, onTaskDeleted, onShowTasks, currentTaskId, currentTaskLabel, drawerOpen }: {
  onApplyFilters: (filters: VoiceFilters) => void;
  onNavigate: (target: VoiceNavigateTarget) => void;
  // "act" mode's write landed on currentTaskId — merge it in, no refetch needed.
  onTaskUpdated: (task: VoiceTaskUpdate) => void;
  // "next"/"walk" resolved another task (or a chained goto_next inside
  // "act" did) — open it, the same way clicking its card would.
  onOpenTask: (taskId: number) => void;
  // "create_task" landed a brand-new row server-side already — prepend
  // it and open it, the same way a manual "New action item" save does.
  onTaskCreated: (task: VoiceCreatedTask, dimensions: VoiceDimensions) => void;
  // A confirmed delete completed server-side — remove it locally and
  // close the drawer if it was open.
  onTaskDeleted: (taskId: number) => void;
  // "briefing" flags a set of tasks that don't fit any single Filters
  // shape (overdue-owned OR due-today-owned OR due-today-recipient) —
  // requested 2026-09-08, "physically select this task to be showing
  // in the list": narrows the on-screen list to exactly these ids,
  // separate from the Filters-object-based filtering onApplyFilters
  // drives, so the summary you just heard is also what you see.
  onShowTasks: (taskIds: number[]) => void;
  // Whichever task is currently open on screen (the drawer), owned by
  // the parent — not local state here, so a manual card click and a
  // voice-driven "next" both keep exactly one source of truth for what
  // "this task" refers to.
  currentTaskId: number | null;
  // Its subject, purely for display — confirmed live 2026-09-07 that
  // it wasn't obvious which task voice commands would act on. null
  // renders no banner at all, same as no task being in focus.
  currentTaskLabel: string | null;
  // Whether the task drawer (or new-task/paste-minutes overlay) is
  // currently open — requested 2026-09-09: confirmed live, this panel's
  // own fixed left-6/left-[270px] positioning could sit underneath the
  // right-docked drawer at plenty of realistic desktop widths, not just
  // the "narrow-but-still-desktop" edge case the original positioning
  // comment already knew about. When true, the panel docks from the
  // RIGHT instead, flush against the drawer's own left edge (see
  // --drawer-w in app/globals.css, the single shared source for that
  // width) — genuinely can't overlap a panel it's positioned relative
  // to, rather than two independently-guessed offsets from opposite
  // sides of the screen.
  drawerOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [liveText, setLiveText] = useState("");
  const [typed, setTyped] = useState("");
  const [log, setLog] = useState<Turn[]>([]);
  // Mirrors log for ask() to read synchronously — confirmed live
  // 2026-09-08: "it doesn't seem to remember what was chatted before."
  // Every turn was classified in total isolation; sending the last
  // couple of exchanges back with each request gives the model actual
  // short-term memory (see app/api/voice-query/route.ts) instead of
  // only knowing which task is in focus.
  const logRef = useRef<Turn[]>([]);
  useEffect(() => { logRef.current = log; }, [log]);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppingRef = useRef(false);
  const finalTextRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Confirmed live 2026-09-04: the continuous-listening restart (start()
  // called again from afterAnswer(), or racing against a manual mic
  // click) could leave the *previous* WebSocket/MediaRecorder still
  // delivering transcript events while a new one was already recording —
  // both writing into the same finalTextRef, producing one question
  // triplicated verbatim in a single turn. Every async step below checks
  // sessionIdRef against the generation it captured at start(), so a
  // stale session's leftover callbacks become no-ops instead of
  // corrupting the current one's transcript.
  const sessionIdRef = useRef(0);
  // True once the mic has been used at least once this panel-open — while
  // true, finishing an answer re-opens the mic automatically instead of
  // waiting for another click. A typed question never sets this, so
  // typing doesn't unexpectedly turn the mic on.
  const voiceSessionRef = useRef(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  // The ordered id list the last "filter" response produced — what
  // "next task" walks through. A ref, not state: it's only ever read
  // when posting a question and written when a filter answer arrives,
  // never something the render needs to react to.
  const workingListRef = useRef<number[]>([]);
  // currentTaskId is a prop, but ask() runs inside callbacks (mic
  // handlers, speak()) that close over stale values — a ref mirrors it
  // so every POST sends whatever's actually on screen right now.
  const currentTaskIdRef = useRef(currentTaskId);
  useEffect(() => { currentTaskIdRef.current = currentTaskId; }, [currentTaskId]);
  // Same generation-guard pattern as sessionIdRef/mySession above, for
  // the pipelined chunk-by-chunk speak() loop: interruptSpeech() bumps
  // this, so a synthesis fetch still in flight (or a chunk mid-
  // playback) for the answer being cut off becomes a no-op instead of
  // continuing to speak once a newer answer/interrupt has taken over.
  const speechIdRef = useRef(0);
  // Resolves the Promise speak()'s loop is currently awaiting on a
  // playing chunk — pausing audio fires neither onended nor onerror,
  // so without this, interrupting mid-chunk would leave that await
  // hanging forever instead of letting the loop notice speechIdRef
  // changed and stop.
  const resolveCurrentChunkRef = useRef<(() => void) | null>(null);
  // Aborts any chunk syntheses still in flight when interrupted — a
  // skip partway through a 4-sentence answer would otherwise still pay
  // for (and wait on) synthesizing the sentences it'll never play.
  const chunkAbortControllersRef = useRef<AbortController[]>([]);
  // Set only after a "delete this task" request comes back asking for
  // confirmation — the NEXT utterance is checked against this, by a
  // plain keyword match, BEFORE it ever reaches the classify endpoint.
  // Deliberately never inferred by the AI itself: a destructive,
  // irreversible action needs a harder gate than "the model thinks this
  // sounds like a yes." A ref, not state — read/cleared synchronously
  // at the top of ask(), never something a render needs to react to.
  const pendingDeleteRef = useRef<{ id: number; subject: string } | null>(null);

  // Tears down whatever the *previous* generation left behind — a live
  // WebSocket, an active MediaRecorder/mic stream — before a new one
  // (if any) takes over. Bumps sessionIdRef itself, so any in-flight
  // async step from the old generation (an awaited fetch, a lingering
  // onmessage) can compare against it and bail out.
  function teardown() {
    sessionIdRef.current++;
    stoppingRef.current = true;
    recorderRef.current?.stop(); recorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    wsRef.current?.close(); wsRef.current = null;
  }

  // Stops whatever speak() is doing right now — the currently-playing
  // chunk, any not-yet-finished synthesis fetches for the chunks after
  // it, and unblocks speak()'s loop so it notices and returns instead
  // of moving on to the next chunk anyway.
  function interruptSpeech() {
    speechIdRef.current++;
    chunkAbortControllersRef.current.forEach(c => c.abort());
    chunkAbortControllersRef.current = [];
    audioRef.current?.pause(); audioRef.current = null;
    resolveCurrentChunkRef.current?.(); resolveCurrentChunkRef.current = null;
  }

  function closePanel() {
    voiceSessionRef.current = false;
    teardown();
    interruptSpeech();
    setOpen(false); setStatus("idle"); setLiveText(""); setError("");
  }

  // Plain keyword check, not a model call — see pendingDeleteRef above
  // for why this stays deterministic. Ambiguous input (neither a clear
  // yes nor no) errs toward NOT deleting, same safety bias as the
  // existing browser confirm() dialog on the Delete button.
  function isAffirmative(text: string) { return /^\s*(yes|yeah|yep|yup|confirm(ed)?|do it|go ahead|correct|sure|please do)\b/i.test(text); }
  function isNegative(text: string) { return /^\s*(no|nope|never\s?mind|cancel|stop|don'?t)\b/i.test(text); }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    // A new question is the clearest possible "I'm done listening to
    // that" signal, whether it arrived by typing over a still-playing
    // answer or by tapping skip — stop it immediately rather than
    // letting two answers overlap.
    interruptSpeech();

    // A delete confirmation is pending from the previous turn — resolve
    // it here, deterministically, before this utterance ever reaches
    // the classify endpoint. Whatever this utterance actually says only
    // matters as far as yes/no; it's never treated as a new question.
    if (pendingDeleteRef.current) {
      const pending = pendingDeleteRef.current;
      pendingDeleteRef.current = null;
      setLog(prev => [...prev, { role: "user", text: trimmed }]);
      if (isAffirmative(trimmed)) {
        setStatus("processing"); setError("");
        try {
          const res = await fetch("/api/voice-query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmDeleteTaskId: pending.id }) });
          const data = await res.json() as { mode?: string; deletedTaskId?: number; spokenAnswer?: string; error?: string };
          if (!res.ok) { setStatus("error"); setError(data.error || "Could not delete that"); return; }
          const answer = data.spokenAnswer || "";
          setLog(prev => [...prev, { role: "assistant", text: answer }]);
          if (data.mode === "deleted" && data.deletedTaskId != null) onTaskDeleted(data.deletedTaskId);
          await speak(answer);
        } catch {
          setStatus("error"); setError("Could not reach Task AI — check your connection.");
        }
        return;
      }
      // A clear "no", or anything else that isn't a clear "yes" — both
      // just cancel. An ambiguous reply not being treated as the
      // original question again is deliberate: safer to make the user
      // re-ask than to risk half-parsing a stray word as a new command
      // while a delete was still technically on the table.
      const answer = isNegative(trimmed) ? "Okay, keeping it." : "I didn't catch a yes or no, so I'll leave it as is.";
      setLog(prev => [...prev, { role: "assistant", text: answer }]);
      await speak(answer);
      return;
    }

    // Read before appending this turn — exactly what was said before
    // this question, oldest first, capped short so the added cost per
    // turn is a few sentences, not another driver of the latency this
    // was just tuned for.
    const recentHistory = logRef.current.slice(-6);
    setLog(prev => [...prev, { role: "user", text: trimmed }]);
    setStatus("processing"); setError("");
    try {
      const res = await fetch("/api/voice-query", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: trimmed, currentTaskId: currentTaskIdRef.current, workingList: workingListRef.current, history: recentHistory }),
      });
      const data = await res.json() as {
        mode?: string; filters?: VoiceFilters | null; navigateTarget?: VoiceNavigateTarget | null;
        workingListIds?: number[]; task?: VoiceTaskUpdate | VoiceCreatedTask | null; tasks?: VoiceTaskUpdate[] | null;
        nextTaskId?: number | null; openTaskId?: number | null;
        dimensions?: VoiceDimensions; pendingDeleteTaskId?: number | null;
        spokenAnswer?: string; error?: string;
      };
      if (!res.ok) { setStatus("error"); setError(data.error || "Could not process that"); return; }
      const answer = data.spokenAnswer || "";
      setLog(prev => [...prev, { role: "assistant", text: answer }]);
      if (data.mode === "filter" || data.mode === "walk") {
        if (data.filters) onApplyFilters(data.filters);
        // Seeds (or replaces) what "next task" will walk through —
        // every filter/walk/briefing response carries a fresh ordered
        // list, so asking a new question always restarts from its
        // results.
        if (data.workingListIds) workingListRef.current = data.workingListIds;
        // "walk" additionally opens and reads the first match itself.
        if (data.mode === "walk" && data.openTaskId != null) onOpenTask(data.openTaskId);
      }
      // "briefing" is a spoken summary only — it doesn't touch the
      // on-screen filter (there's no single Filters shape for "overdue
      // OR due today OR due today as recipient"), but "next task"
      // afterward pages through exactly what got flagged.
      if (data.mode === "briefing" && data.workingListIds) {
        workingListRef.current = data.workingListIds;
        onShowTasks(data.workingListIds);
      }
      if (data.mode === "navigate" && data.navigateTarget) {
        onNavigate(data.navigateTarget);
        await speak(answer);
        // Only a real full-page navigation (dictate, via location.href)
        // needs this — confirmed live 2026-09-08: "the Ask Session
        // disrupt[ed]" itself whenever a command merely opened the new-
        // task/paste-minutes overlay, closing the whole panel over an
        // in-page form that isn't actually leaving the screen at all.
        if (data.navigateTarget === "dictate") closePanel();
        return;
      }
      if (data.mode === "act") {
        // A bulk command ("add this to all of these") updates several
        // tasks at once — merge each in the same way a single-task
        // update already does, one call per task. `task` (singular)
        // still covers the ordinary one-task case.
        if (data.tasks?.length) data.tasks.forEach(t => onTaskUpdated(t));
        else if (data.task) onTaskUpdated(data.task as VoiceTaskUpdate);
        // A chained "...and go to the next task" resolved as part of
        // the same turn — open it right after applying the write.
        if (data.nextTaskId != null) onOpenTask(data.nextTaskId);
      }
      if (data.mode === "confirm_delete" && data.pendingDeleteTaskId != null) {
        pendingDeleteRef.current = { id: data.pendingDeleteTaskId, subject: currentTaskLabel || "this task" };
      }
      if (data.mode === "created" && data.task && data.dimensions) onTaskCreated(data.task as VoiceCreatedTask, data.dimensions);
      if (data.mode === "next" && data.nextTaskId != null) onOpenTask(data.nextTaskId);
      await speak(answer);
    } catch {
      setStatus("error"); setError("Could not reach Task AI — check your connection.");
    }
  }

  // Synthesizes one chunk, silently returning null on failure or
  // interruption — a single sentence failing to speak shouldn't abort
  // the rest of the answer any more than the whole thing failing
  // already did (the text is already in the log either way).
  async function synthesizeChunk(text: string, controller: AbortController): Promise<Blob | null> {
    try {
      const res = await fetch("/api/dictate/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  async function speak(text: string) {
    const chunks = splitIntoSpeechChunks(text);
    if (!chunks.length) { afterAnswer(); return; }
    const mySpeech = ++speechIdRef.current;
    const isCurrentSpeech = () => speechIdRef.current === mySpeech;

    // Every chunk's synthesis kicks off up front, pipelined — chunk 2
    // is already downloading while chunk 1 is still playing, instead
    // of only starting once chunk 1 finishes and leaving a gap.
    const controllers = chunks.map(() => new AbortController());
    chunkAbortControllersRef.current = controllers;
    const pending = chunks.map((chunk, i) => synthesizeChunk(chunk, controllers[i]));

    setStatus("speaking");
    for (let i = 0; i < pending.length; i++) {
      if (!isCurrentSpeech()) return; // interrupted while an earlier chunk was still playing
      const blob = await pending[i];
      if (!isCurrentSpeech()) return; // interrupted while this chunk's synthesis was in flight
      if (!blob) continue; // this one sentence failed to synthesize — skip it, not the whole answer
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>(resolve => {
        resolveCurrentChunkRef.current = resolve;
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      resolveCurrentChunkRef.current = null;
      URL.revokeObjectURL(url);
      if (!isCurrentSpeech()) return; // interrupted while this chunk was playing
    }
    afterAnswer();
  }

  // Runs once an answer has finished being spoken (or there was nothing
  // to speak). Re-opens the mic automatically if this was a voice
  // session and the panel is still open — the continuous-listening loop.
  function afterAnswer() {
    setStatus("idle");
    if (voiceSessionRef.current && openRef.current) void start();
  }

  // Confirmed live 2026-09-07: during a "walk" session the text answer
  // is already visible the instant it arrives (setLog happens before
  // speak() is even called) — the full narration is only useful if
  // you're not already looking at the screen. Tapping the mic mid-
  // answer cuts the audio and starts listening right away instead of
  // making every turn wait through a full read-out first.
  function skipSpeaking() {
    interruptSpeech();
    setStatus("idle");
    void start();
  }

  async function start() {
    teardown(); // guarantees no previous session's WebSocket/recorder is still live before this one begins
    const mySession = sessionIdRef.current;
    const isCurrent = () => sessionIdRef.current === mySession;

    voiceSessionRef.current = true;
    setError(""); setLiveText(""); finalTextRef.current = ""; stoppingRef.current = false;
    setStatus("connecting");
    try {
      const tokenRes = await fetch("/api/dictate/token", { method: "POST" });
      if (!isCurrent()) return; // a newer session started while this fetch was in flight
      const tokenData = await tokenRes.json() as { token?: string; glossary?: string[]; model?: string; error?: string };
      if (!isCurrent()) return;
      if (!tokenRes.ok || !tokenData.token) { setStatus("error"); setError(tokenData.error || "Could not start voice capture"); voiceSessionRef.current = false; return; }

      const params = new URLSearchParams({
        model: tokenData.model || "nova-3", smart_format: "true", punctuate: "true", interim_results: "true",
        // Confirmed live 2026-09-07: "the lag is quite long" — this is
        // the single biggest fixed contributor and the easiest one to
        // just tune. Both were 3000ms, meaning Deepgram waited a full 3
        // silent seconds after every command before even considering it
        // finished, before any classify/act/speak step could start. A
        // short voice command doesn't need that much grace; 900/1200
        // still tolerates a brief mid-command pause without feeling
        // like it's still waiting on you. Raise these back toward 3000
        // if real use shows commands getting cut off mid-sentence.
        endpointing: "900", utterance_end_ms: "1200",
      });
      for (const term of tokenData.glossary || []) params.append("keyterm", term);
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ["token", tokenData.token]);
      wsRef.current = ws;

      ws.onerror = () => { if (!isCurrent()) return; setStatus("error"); setError("Could not connect to the transcription service."); voiceSessionRef.current = false; };
      ws.onclose = () => {}; // stop() already settles state on a clean close; a mid-recording drop just leaves status as-is rather than guessing

      ws.onmessage = event => {
        if (!isCurrent()) return; // this session's own WebSocket, but a newer generation has since taken over — a delivery still in flight when teardown() closed it
        try {
          const msg = JSON.parse(event.data as string) as { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string }> } };
          if (msg.type === "UtteranceEnd") { void stop(mySession); return; }
          if (msg.type !== "Results") return;
          const transcript = msg.channel?.alternatives?.[0]?.transcript || "";
          if (msg.is_final) {
            if (transcript) finalTextRef.current = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
            setLiveText("");
          } else {
            setLiveText(transcript);
          }
          if (msg.speech_final) void stop(mySession);
        } catch { /* ignore malformed/non-JSON control frames */ }
      };

      ws.onopen = async () => {
        if (!isCurrent()) return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!isCurrent()) { stream.getTracks().forEach(t => t.stop()); return; } // superseded while waiting on mic permission — don't leave this stream capturing
          streamRef.current = stream;
          const mimeType = pickMimeType();
          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = e => { if (isCurrent() && e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data); };
          recorder.start(250);
          recorderRef.current = recorder;
          setStatus("recording");
        } catch (err) {
          if (!isCurrent()) return;
          setStatus("error"); setError(describeMicError(err));
          voiceSessionRef.current = false;
          ws.close();
        }
      };
    } catch {
      if (!isCurrent()) return;
      setStatus("error"); setError("Could not start voice capture — check your connection.");
      voiceSessionRef.current = false;
    }
  }

  // sessionGuard, when passed, must still match the current generation —
  // stop() otherwise only ever runs against whatever's live right now
  // (the manual ■ button has no earlier generation to be stale against).
  async function stop(sessionGuard?: number) {
    if (sessionGuard !== undefined && sessionGuard !== sessionIdRef.current) return;
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const mySession = sessionIdRef.current;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "CloseStream" })); } catch { /* socket already gone */ }
      setTimeout(() => ws.close(), 300);
    }
    const heard = finalTextRef.current.trim();
    finalTextRef.current = ""; // consumed — a straggling message from this closing socket must not get appended to the *next* session's transcript
    if (heard) void ask(heard);
    else if (voiceSessionRef.current && openRef.current && sessionIdRef.current === mySession) void start(); // heard nothing this round — stay listening rather than dropping out of the loop silently
    else { setStatus("idle"); setError("Didn't catch that — try again."); }
  }

  function stopListening() {
    voiceSessionRef.current = false;
    void stop();
  }

  return (
    <>
      {/* Two different problems, two different fixes, both confirmed live:
          1) (2026-09-07) The drawer's dimmed backdrop (.overlay) used to
             share ONE z-index with its own opaque content — without
             lifting this button above that shared layer, the dim
             painted over it and a real click never landed, even though
             it looked clickable.
          2) (2026-09-09, from a real screenshot) That same lift also
             painted this button OVER the drawer's actual content
             wherever the two happened to share screen space — which,
             once the drawer got wide enough (see --drawer-w in app/
             globals.css), turned out to be almost always on a normal
             desktop width, not some narrow edge case. Splitting the
             z-index (.overlay's dim stays low, .drawer's own content
             got z-40, see app/globals.css) fixed the visual overlap —
             but then correctly and totally hid this button behind the
             now-opaque drawer instead, right back to problem 1: while a
             drawer's open, the button that's supposed to let you open
             the assistant on top of it became unreachable again.
          Real fix: while a drawer's open AND the panel itself is
          closed, this button leaves the header's normal layout flow
          entirely and floats in the same fixed, drawer-aware safe spot
          the open panel itself uses (right-anchored against
          --drawer-w) — nowhere left for it to collide with the
          drawer's content, because it's no longer sharing that
          horizontal space at all. Once the panel opens, this button
          goes back to its ordinary (harmless, hidden-behind-the-drawer)
          header position — the panel's own × already covers closing it,
          and the panel itself takes over that same safe spot the button
          just vacated, so nothing needs both at once. */}
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className={
          drawerOpen && !open
            ? "fixed z-30 bottom-6 left-6 min-[621px]:left-auto min-[621px]:right-[calc(var(--drawer-w)_+_1.5rem)] h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3] shadow-[0_8px_30px_rgba(16,47,89,0.2)]"
            : "relative z-30 h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3]"
        }
      >
        🗣️ Ask Task AI
      </button>
      {open && (
        // Deliberately not a full-screen modal — confirmed live that
        // covering the dashboard meant closing this panel just to see
        // what a filter command actually did. Docked in a corner instead,
        // so the (now-visibly-updating) task list stays in view the whole
        // time this stays open.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onKeyDown is Escape-to-close, the keyboard-accessible equivalent of the × button right below
        <div
          role="dialog" aria-label="Ask Task AI"
          // Confirmed live 2026-09-08: docked at bottom-right, this sat
          // directly on top of a task's drawer — which also docks
          // right (see .overlay/.drawer in app/globals.css). First fix
          // was to dock left instead (below ~620px the sidebar collapses
          // off-canvas, matching app/globals.css's own mobile breakpoint,
          // so left-6 sits where the sidebar would be; above it, left-
          // [270px] clears the sidebar's own 246px width) — but that was
          // two independently-guessed offsets from opposite edges of the
          // screen, and confirmed live again 2026-09-09 that plenty of
          // realistic desktop widths still overlapped, not just the
          // narrow edge case the first fix called out. Real fix: while a
          // drawer is open, stop guessing a left offset entirely and
          // dock from the RIGHT, flush against the drawer's own left
          // edge (--drawer-w, the same custom property the drawer's own
          // width comes from in app/globals.css — one shared number, so
          // the two can't drift apart into an overlap again). No drawer
          // open still uses the original left-docked position — no
          // reason to change what was never the problem.
          className={`fixed bottom-6 z-50 w-[calc(100%-3rem)] max-w-sm bg-white rounded-2xl shadow-[0_8px_30px_rgba(16,47,89,0.2)] border border-[#e3e8ee] flex flex-col p-5 max-h-[70vh] ${drawerOpen ? "left-6 min-[621px]:left-auto min-[621px]:right-[calc(var(--drawer-w)_+_1.5rem)]" : "left-6 min-[621px]:left-[270px]"}`}
          onKeyDown={e => { if (e.key === "Escape") closePanel(); }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-[#102f59]">Ask Task AI</h2>
            <button type="button" onClick={closePanel} className="text-[#697181] text-xl leading-none">×</button>
          </div>

          {/* Confirmed live 2026-09-07: "it's not clear which task we're
              talking about" — this makes "this task" unambiguous the
              whole time a task is in focus, through a "walk" session or
              otherwise, instead of only being knowable by remembering
              which card you last clicked. */}
          {currentTaskLabel && (
            <div className="text-xs font-semibold text-[#173f76] bg-[#eef3fa] rounded-lg px-3 py-2 mb-3 truncate" title={currentTaskLabel}>
              🗂️ Talking about: {currentTaskLabel}
            </div>
          )}

          <div className="flex-1 overflow-y-auto mb-3 flex flex-col gap-2 min-h-[80px]">
            {log.length === 0 && <p className="text-sm text-[#8b929d]">{`Try "Give me my morning briefing," "Create a task to send the invoice by Friday," or "Push this to Friday and assign it to Maya."`}</p>}
            {log.map((turn, i) => (
              <div key={i} className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${turn.role === "user" ? "self-end bg-[#173f76] text-white" : "self-start bg-[#f1f3f7] text-[#202735]"}`}>
                {turn.text}
              </div>
            ))}
            {status === "recording" && liveText && <div className="self-end text-sm text-[#9299a3] italic">{liveText}…</div>}
          </div>

          {error && <div className="text-xs text-[#a84235] mb-2">{error}</div>}

          <div className="flex items-center gap-2">
            {status === "recording" ? (
              <button type="button" onClick={stopListening} className="h-10 w-10 shrink-0 rounded-full bg-[#c96539] text-white animate-pulse" aria-label="Stop listening">■</button>
            ) : status === "speaking" ? (
              <button type="button" onClick={skipSpeaking} className="h-10 w-10 shrink-0 rounded-full bg-[#173f76] text-white" aria-label="Skip and listen">⏭</button>
            ) : (
              <button type="button" onClick={() => void start()} disabled={status === "connecting" || status === "processing"} className="h-10 w-10 shrink-0 rounded-full bg-[#173f76] text-white disabled:opacity-50" aria-label="Ask by voice">🎤</button>
            )}
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && typed.trim()) { void ask(typed); setTyped(""); } }}
              placeholder="…or type your question"
              disabled={status === "processing"}
              className="flex-1 h-10 px-3 rounded-lg border border-[#d9dee5] text-sm outline-none focus:border-[#7898be]"
            />
          </div>
          <div className="text-xs text-[#8b929d] mt-2 h-4">
            {status === "connecting" && "Connecting…"}
            {status === "recording" && "● Listening — pauses automatically, or tap ■ to stop for good"}
            {status === "processing" && "Thinking…"}
            {status === "speaking" && "🔊 Speaking — tap ⏭ to skip and keep going"}
          </div>
        </div>
      )}
    </>
  );
}

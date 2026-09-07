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
  owner: string | null; mineOnly: boolean; project: string | null; topic: string | null; recurringMeeting: string | null;
  priority: "Low" | "Medium" | "High" | null; dueWithin: "week" | "overdue" | null;
  createdWithin: "today" | null; closedWithin: "today" | null; status: string | null;
};
export type VoiceNavigateTarget = "dictate" | "new_task" | "paste_minutes";
// What an "act" response hands back — every field any voice-driven
// change could have touched (due, status+closedAt together, priority,
// owner, or updates), so the caller can merge this straight into its
// task state without a full refetch.
export type VoiceTaskUpdate = { id: number; due: string; status: string; priority: string; owner: string; closedAt: string | null; updates: Array<{ text: string; at: string; by?: string }> };
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


export default function VoiceAsk({ onApplyFilters, onNavigate, onTaskUpdated, onOpenTask, currentTaskId, currentTaskLabel }: {
  onApplyFilters: (filters: VoiceFilters) => void;
  onNavigate: (target: VoiceNavigateTarget) => void;
  // "act" mode's write landed on currentTaskId — merge it in, no refetch needed.
  onTaskUpdated: (task: VoiceTaskUpdate) => void;
  // "next"/"walk" resolved another task (or a chained goto_next inside
  // "act" did) — open it, the same way clicking its card would.
  onOpenTask: (taskId: number) => void;
  // Whichever task is currently open on screen (the drawer), owned by
  // the parent — not local state here, so a manual card click and a
  // voice-driven "next" both keep exactly one source of truth for what
  // "this task" refers to.
  currentTaskId: number | null;
  // Its subject, purely for display — confirmed live 2026-09-07 that
  // it wasn't obvious which task voice commands would act on. null
  // renders no banner at all, same as no task being in focus.
  currentTaskLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [liveText, setLiveText] = useState("");
  const [typed, setTyped] = useState("");
  const [log, setLog] = useState<Turn[]>([]);

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

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    // A new question is the clearest possible "I'm done listening to
    // that" signal, whether it arrived by typing over a still-playing
    // answer or by tapping skip — stop it immediately rather than
    // letting two answers overlap.
    interruptSpeech();
    setLog(prev => [...prev, { role: "user", text: trimmed }]);
    setStatus("processing"); setError("");
    try {
      const res = await fetch("/api/voice-query", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: trimmed, currentTaskId: currentTaskIdRef.current, workingList: workingListRef.current }),
      });
      const data = await res.json() as {
        mode?: string; filters?: VoiceFilters | null; navigateTarget?: VoiceNavigateTarget | null;
        workingListIds?: number[]; task?: VoiceTaskUpdate | null; nextTaskId?: number | null; openTaskId?: number | null;
        spokenAnswer?: string; error?: string;
      };
      if (!res.ok) { setStatus("error"); setError(data.error || "Could not process that"); return; }
      const answer = data.spokenAnswer || "";
      setLog(prev => [...prev, { role: "assistant", text: answer }]);
      if (data.mode === "filter" || data.mode === "walk") {
        if (data.filters) onApplyFilters(data.filters);
        // Seeds (or replaces) what "next task" will walk through —
        // every filter/walk response carries a fresh ordered list, so
        // asking a new question always restarts the walk from its results.
        if (data.workingListIds) workingListRef.current = data.workingListIds;
        // "walk" additionally opens and reads the first match itself.
        if (data.mode === "walk" && data.openTaskId != null) onOpenTask(data.openTaskId);
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
        if (data.task) onTaskUpdated(data.task);
        // A chained "...and go to the next task" resolved as part of
        // the same turn — open it right after applying the write.
        if (data.nextTaskId != null) onOpenTask(data.nextTaskId);
      }
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
      {/* relative z-30: confirmed live 2026-09-07 — a task's drawer
          renders a full-viewport dimmed backdrop at z-index:20 (see
          .overlay in app/globals.css) with no z-index of its own on the
          header underneath, so without this the backdrop paints over
          this button and a real click never reaches it, even though it
          looks clickable. z-30 lifts it above that backdrop (still well
          under the panel's own z-50 below) without moving it out of the
          header's normal layout flow — the whole point of "this task"
          context is being able to open the assistant while a task is
          already open. */}
      <button type="button" onClick={() => setOpen(o => !o)} className="relative z-30 h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3]">
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
          className="fixed bottom-6 right-6 z-50 w-[calc(100%-3rem)] max-w-sm bg-white rounded-2xl shadow-[0_8px_30px_rgba(16,47,89,0.2)] border border-[#e3e8ee] flex flex-col p-5 max-h-[70vh]"
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
            {log.length === 0 && <p className="text-sm text-[#8b929d]">{`Try "Walk me through my overdue tasks," "Push this to Friday and assign it to Maya," or "Next task."`}</p>}
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

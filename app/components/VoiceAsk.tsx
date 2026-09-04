"use client";
import { useRef, useState } from "react";

// The lightweight alternative to a full conversational voice agent — see
// app/api/voice-query/route.ts for the reasoning. Reuses the exact mic/
// WebSocket/TTS plumbing already proven in app/dictate/DictateClient.tsx
// (same Deepgram token/transcription/speak routes), just pointed at a
// different backend call: instead of "extract a task from this text",
// "understand this question against the tasks I can currently see, and
// either filter the screen or answer it out loud."
//
// Each utterance is independent — there's no open session remembering
// what you asked a moment ago. That's the real tradeoff against a true
// voice agent, acceptable for single-shot commands like "what's due this
// week" and revisit only if genuine back-and-forth turns out to matter.

export type VoiceFilters = {
  owner: string | null; mineOnly: boolean; project: string | null; topic: string | null; recurringMeeting: string | null;
  priority: "Low" | "Medium" | "High" | null; dueWithin: "week" | "overdue" | null; status: string | null;
};
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

export default function VoiceAsk({ onApplyFilters }: { onApplyFilters: (filters: VoiceFilters) => void }) {
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

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    setLog(prev => [...prev, { role: "user", text: trimmed }]);
    setStatus("processing"); setError("");
    try {
      const res = await fetch("/api/voice-query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: trimmed }) });
      const data = await res.json() as { mode?: string; filters?: VoiceFilters | null; spokenAnswer?: string; error?: string };
      if (!res.ok) { setStatus("error"); setError(data.error || "Could not process that"); return; }
      const answer = data.spokenAnswer || "";
      setLog(prev => [...prev, { role: "assistant", text: answer }]);
      if (data.mode === "filter" && data.filters) onApplyFilters(data.filters);
      await speak(answer);
    } catch {
      setStatus("error"); setError("Could not reach Task AI — check your connection.");
    }
  }

  async function speak(text: string) {
    if (!text.trim()) { setStatus("idle"); return; }
    setStatus("speaking");
    try {
      const res = await fetch("/api/dictate/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) { setStatus("idle"); return; } // silent — the text answer is already in the log either way
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setStatus("idle"); };
      audio.onerror = () => { URL.revokeObjectURL(url); setStatus("idle"); };
      await audio.play();
    } catch {
      setStatus("idle");
    }
  }

  async function start() {
    setError(""); setLiveText(""); finalTextRef.current = ""; stoppingRef.current = false;
    setStatus("connecting");
    try {
      const tokenRes = await fetch("/api/dictate/token", { method: "POST" });
      const tokenData = await tokenRes.json() as { token?: string; glossary?: string[]; model?: string; error?: string };
      if (!tokenRes.ok || !tokenData.token) { setStatus("error"); setError(tokenData.error || "Could not start voice capture"); return; }

      const params = new URLSearchParams({
        model: tokenData.model || "nova-3", smart_format: "true", punctuate: "true", interim_results: "true",
        endpointing: "3000", utterance_end_ms: "3000",
      });
      for (const term of tokenData.glossary || []) params.append("keyterm", term);
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ["token", tokenData.token]);
      wsRef.current = ws;

      ws.onerror = () => { setStatus("error"); setError("Could not connect to the transcription service."); };
      ws.onclose = () => {}; // stop() already settles state on a clean close; a mid-recording drop just leaves status as-is rather than guessing

      ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data as string) as { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string }> } };
          if (msg.type === "UtteranceEnd") { void stop(); return; }
          if (msg.type !== "Results") return;
          const transcript = msg.channel?.alternatives?.[0]?.transcript || "";
          if (msg.is_final) {
            if (transcript) finalTextRef.current = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
            setLiveText("");
          } else {
            setLiveText(transcript);
          }
          if (msg.speech_final) void stop();
        } catch { /* ignore malformed/non-JSON control frames */ }
      };

      ws.onopen = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          const mimeType = pickMimeType();
          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = e => { if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data); };
          recorder.start(250);
          recorderRef.current = recorder;
          setStatus("recording");
        } catch (err) {
          setStatus("error"); setError(describeMicError(err));
          ws.close();
        }
      };
    } catch {
      setStatus("error"); setError("Could not start voice capture — check your connection.");
    }
  }

  async function stop() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "CloseStream" })); } catch { /* socket already gone */ }
      setTimeout(() => ws.close(), 300);
    }
    const heard = finalTextRef.current.trim();
    if (heard) void ask(heard);
    else { setStatus("idle"); setError("Didn't catch that — try again."); }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)} className="h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3]">
        🗣️ Ask Task AI
      </button>
      {open && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a click-outside-to-dismiss backdrop is deliberately not a keyboard target; Escape (below, on the dialog) is the keyboard equivalent
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onMouseDown={() => setOpen(false)}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onMouseDown here is just stopPropagation, keeping a click inside the panel from bubbling to the backdrop's dismiss handler; onKeyDown is Escape-to-close, the dialog's own keyboard-accessible equivalent of that same dismiss action */}
          <div
            role="dialog" aria-modal="true" aria-label="Ask Task AI"
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col p-5"
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-[#102f59]">Ask Task AI</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-[#697181] text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto mb-3 flex flex-col gap-2 min-h-[80px]">
              {log.length === 0 && <p className="text-sm text-[#8b929d]">{`Try "What are my tasks for the week?" or "Show me all tasks with Shankar."`}</p>}
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
                <button type="button" onClick={() => void stop()} className="h-10 w-10 shrink-0 rounded-full bg-[#c96539] text-white animate-pulse" aria-label="Stop">■</button>
              ) : (
                <button type="button" onClick={() => void start()} disabled={status === "connecting" || status === "processing" || status === "speaking"} className="h-10 w-10 shrink-0 rounded-full bg-[#173f76] text-white disabled:opacity-50" aria-label="Ask by voice">🎤</button>
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
              {status === "processing" && "Thinking…"}
              {status === "speaking" && "🔊 Speaking…"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

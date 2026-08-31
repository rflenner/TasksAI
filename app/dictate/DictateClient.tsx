"use client";
import Link from "next/link";
import { useRef, useState } from "react";

type Status = "idle" | "connecting" | "recording" | "stopped" | "creating" | "error";

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

// Minimal stand-in for TaskApp.js's private m() mapper — that function
// isn't exported (this page is a separate route, not part of the main
// component tree), so this replicates just enough of its defaulting to
// turn one /api/extract result into something /api/tasks POST will accept
// (subject and owner are the only required fields there).
function toTaskInput(extracted: Record<string, unknown>) {
  return {
    subject: String(extracted.subject || extracted.description || "Dictated task").slice(0, 140),
    description: String(extracted.description || extracted.subject || "Task captured by voice dictation"),
    owner: String(extracted.owner || "Unassigned"),
    collaborators: Array.isArray(extracted.collaborators) ? extracted.collaborators : [],
    recipients: Array.isArray(extracted.recipients) && extracted.recipients.length ? extracted.recipients : ["Project team"],
    due: /^\d{4}-\d{2}-\d{2}$/.test(String(extracted.due || "")) ? String(extracted.due) : "",
    source: "Voice dictation",
    topic: String(extracted.topic || ""),
    project: String(extracted.project || ""),
    recurringMeeting: String(extracted.recurringMeeting || ""),
    status: "Open",
    created: new Date().toISOString().slice(0, 10),
    updates: [],
  };
}

export default function DictateClient() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [liveText, setLiveText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [editableText, setEditableText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  // finalText/liveText mirrored into refs so stop() always reads the
  // current transcript. ws.onmessage is assigned once, inside start(),
  // and never reassigned on re-render — so a plain closure over finalText/
  // liveText state would freeze at whatever those were at connection time
  // (almost always empty), silently dropping the transcript on any
  // server-triggered auto-stop even if the stop itself fired correctly.
  const finalTextRef = useRef("");
  const liveTextRef = useRef("");

  async function start() {
    setError(""); setLiveText(""); setFinalText(""); setEditableText("");
    finalTextRef.current = ""; liveTextRef.current = "";
    stoppingRef.current = false;
    setStatus("connecting");
    try {
      const tokenRes = await fetch("/api/dictate/token", { method: "POST" });
      const tokenData = await tokenRes.json() as { token?: string; glossary?: string[]; model?: string; error?: string };
      if (!tokenRes.ok || !tokenData.token) { setStatus("error"); setError(tokenData.error || "Could not start voice capture"); return; }

      const params = new URLSearchParams({
        model: tokenData.model || "nova-3",
        smart_format: "true",
        punctuate: "true",
        interim_results: "true",
        // Two overlapping silence signals: endpointing marks speech_final
        // on the results message that closes out an utterance after this
        // many ms of trailing silence; utterance_end_ms is Deepgram's
        // purpose-built "user stopped talking" event, sent as its own
        // message type rather than riding along a transcript message —
        // more reliable on its own since it doesn't depend on exactly
        // how/when a final transcript message happens to be emitted.
        // Listening for both and stopping on whichever fires first.
        endpointing: "5000",
        utterance_end_ms: "5000",
      });
      for (const term of tokenData.glossary || []) params.append("keyterm", term);
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ["token", tokenData.token]);
      wsRef.current = ws;

      ws.onerror = () => { setStatus("error"); setError("Could not connect to the transcription service."); };
      ws.onclose = () => { if (status === "connecting") { setStatus("error"); setError("Connection to the transcription service closed unexpectedly."); } };

      ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data as string) as { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string }> } };
          if (msg.type === "UtteranceEnd") { void stop(); return; }
          if (msg.type !== "Results") return;
          const transcript = msg.channel?.alternatives?.[0]?.transcript || "";
          if (msg.is_final) {
            if (transcript) {
              finalTextRef.current = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
              setFinalText(finalTextRef.current);
            }
            liveTextRef.current = "";
            setLiveText("");
          } else {
            liveTextRef.current = transcript;
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
          setSeconds(0);
          timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
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
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "CloseStream" })); } catch { /* socket already gone */ }
      setTimeout(() => ws.close(), 300);
    }
    const settled = (finalTextRef.current + (liveTextRef.current ? ` ${liveTextRef.current}` : "")).trim();
    setEditableText(settled);
    setStatus(prev => prev === "error" ? prev : "stopped");
  }

  function startOver() {
    setStatus("idle"); setError(""); setLiveText(""); setFinalText(""); setEditableText(""); setSeconds(0);
    finalTextRef.current = ""; liveTextRef.current = "";
  }

  async function readBack() {
    if (!editableText.trim() || speaking) return;
    setSpeaking(true); setError("");
    try {
      const res = await fetch("/api/dictate/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: editableText }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error || "Could not read the text back"); setSpeaking(false); return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      await audio.play();
    } catch {
      setError("Could not read the text back."); setSpeaking(false);
    }
  }

  async function createTask() {
    if (!editableText.trim()) return;
    setStatus("creating"); setError("");
    try {
      const extractRes = await fetch("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ minutes: editableText }) });
      const extractData = await extractRes.json() as { tasks?: Array<Record<string, unknown>>; error?: string };
      const items = extractRes.ok && extractData.tasks?.length ? extractData.tasks : [{ subject: editableText.slice(0, 140), description: editableText }];
      for (const item of items) {
        const res = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toTaskInput(item)) });
        if (!res.ok) throw new Error("Could not save task");
      }
      window.location.href = "/";
    } catch {
      setStatus("stopped"); setError("Could not create the task — your dictation is still here, try again.");
    }
  }

  const displayText = status === "stopped" || status === "creating" ? editableText : `${finalText}${liveText ? ` ${liveText}` : ""}`;

  return (
    <div className="max-w-2xl mx-auto p-8 min-h-screen flex flex-col">
      <Link href="/" className="text-[13px] font-bold text-[#697181] mb-6 inline-block">← Back to Task AI</Link>
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">DICTATE A TASK</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-2 mb-1">Speak your task</h1>
      <p className="text-[#697181] mb-6">Start recording and just talk — the transcript streams in live below. It stops automatically after about 5 seconds of silence, or you can stop it yourself.</p>

      <div className="flex items-center gap-3 mb-6">
        {status === "idle" && (
          <button onClick={() => void start()} className="h-11 px-5 rounded-lg font-bold text-white bg-[#173f76]">🎤 Start dictating</button>
        )}
        {status === "connecting" && (
          <button disabled className="h-11 px-5 rounded-lg font-bold text-white bg-[#173f76] opacity-60">Connecting…</button>
        )}
        {status === "recording" && (
          <>
            <button onClick={() => void stop()} className="h-11 px-5 rounded-lg font-bold text-white bg-[#c96539]">■ Stop ({seconds}s)</button>
            <span className="text-sm text-[#c96539] font-bold animate-pulse">● listening</span>
          </>
        )}
        {(status === "stopped" || status === "creating") && (
          <>
            <button onClick={startOver} className="h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3]">Record again</button>
            <button onClick={() => void readBack()} disabled={speaking || !editableText.trim()} className="h-11 px-5 rounded-lg font-bold text-[#173f76] bg-white border border-[#d7dce3] disabled:opacity-50">
              {speaking ? "🔊 Reading…" : "🔊 Read it back"}
            </button>
          </>
        )}
      </div>

      {error && <div className="border border-[#e2a39c] bg-[#fdf1ef] text-[#a84235] rounded-lg p-4 text-sm mb-6">{error}</div>}

      <div className="flex-1 flex flex-col">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#8b929d] mb-2">Transcript</div>
        {status === "stopped" || status === "creating" ? (
          <textarea
            value={editableText}
            onChange={e => setEditableText(e.target.value)}
            className="flex-1 min-h-[220px] border border-[#d9dee5] rounded-lg p-4 text-base leading-relaxed text-[#202735] outline-none focus:border-[#7898be]"
            placeholder="Nothing was transcribed — you can type here instead."
          />
        ) : (
          <div className="flex-1 min-h-[220px] border border-[#e3e8ee] bg-white rounded-lg p-4 text-base leading-relaxed text-[#202735] whitespace-pre-wrap">
            {finalText}
            {liveText && <span className="text-[#9299a3]"> {liveText}</span>}
            {!finalText && !liveText && <span className="text-[#b8bfc8]">{status === "recording" ? "Listening…" : "Your words will appear here as you speak."}</span>}
          </div>
        )}
      </div>

      {(status === "stopped" || status === "creating") && (
        <div className="flex justify-end mt-6">
          <button
            onClick={() => void createTask()}
            disabled={status === "creating" || !displayText.trim()}
            className="h-12 px-6 rounded-lg font-bold text-white bg-[#173f76] disabled:opacity-50"
          >
            {status === "creating" ? "Creating…" : "Create task"}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";
import { useRef, useState } from "react";

type Status = "idle" | "recording" | "uploading" | "done" | "error";
type Result = { text: string; ms: number; roundTripMs: number };

// Picks a mimeType MediaRecorder can actually produce on this browser.
// Chrome/Firefox/Android give webm/opus; Safari/iOS gives mp4/aac; if
// neither is explicitly supported we just let the browser pick its default.
function pickMimeType() {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

// getUserMedia failures were previously flattened into one generic
// "denied or unavailable" message regardless of cause, which made this
// impossible to debug remotely — permission-granted-but-still-failing
// reports had no way to tell a real block apart from a busy/missing
// device. Surface the actual DOMException name plus a plain-English
// guess so both a screenshot and a glance are useful.
function describeMicError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  const hint =
    name === "NotAllowedError" ? "permission was denied — check the site and OS microphone settings." :
    name === "NotFoundError" ? "no microphone was found — check a mic is connected and selected as input." :
    name === "NotReadableError" ? "the microphone is in use or unreachable — try closing other apps that use audio (Zoom, DJ software, etc.) and retry." :
    name === "SecurityError" ? "this page isn't considered secure enough for mic access — make sure you're on https://." :
    "an unexpected error occurred.";
  return name ? `Microphone error (${name}): ${hint}` : "Microphone access was denied or unavailable.";
}

export default function VoiceTestClient() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function start() {
    setError(""); setResult(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error"); setError("This browser doesn't support microphone recording."); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => void upload(new Blob(chunksRef.current, { type: mimeType || "audio/webm" }));
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
      setStatus("recording");
    } catch (err) {
      setStatus("error"); setError(describeMicError(err));
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    setStatus("uploading");
  }

  async function upload(blob: Blob) {
    const clientStart = Date.now();
    try {
      const form = new FormData();
      form.append("audio", blob, "clip");
      const res = await fetch("/api/voice-test", { method: "POST", body: form });
      const data = await res.json() as { text?: string; ms?: number; error?: string };
      if (!res.ok) { setStatus("error"); setError(data.error || "Transcription failed"); return; }
      setResult({ text: data.text || "", ms: data.ms || 0, roundTripMs: Date.now() - clientStart });
      setStatus("done");
    } catch {
      setStatus("error"); setError("Upload failed — check your connection.");
    }
  }

  return (
    <div className="max-w-xl mx-auto p-8">
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">AI CAPTURE — TEST</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-2 mb-1">Speech-to-text try-out</h1>
      <p className="text-[#697181] mb-6">Say a task out loud — include a name or project so we can see how it&apos;s transcribed. This is a throwaway test page, nothing here is saved as a task.</p>

      <div className="flex items-center gap-3 mb-6">
        {status !== "recording" ? (
          <button
            onClick={() => void start()}
            disabled={status === "uploading"}
            className="h-11 px-5 rounded-lg font-bold text-white bg-[#173f76] disabled:opacity-50"
          >
            {status === "uploading" ? "Transcribing…" : "🎤 Record"}
          </button>
        ) : (
          <button onClick={stop} className="h-11 px-5 rounded-lg font-bold text-white bg-[#c96539]">
            ■ Stop ({seconds}s)
          </button>
        )}
        {status === "recording" && <span className="text-sm text-[#c96539] font-bold animate-pulse">● recording</span>}
      </div>

      {status === "error" && (
        <div className="border border-[#e2a39c] bg-[#fdf1ef] text-[#a84235] rounded-lg p-4 text-sm">{error}</div>
      )}

      {result && (
        <div className="border border-[#e3e8ee] bg-white rounded-lg p-5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#8b929d] mb-2">Transcript</div>
          <p className="text-base leading-relaxed text-[#202735] whitespace-pre-wrap mb-4">{result.text || "(empty — nothing recognized)"}</p>
          <div className="flex gap-6 text-xs text-[#7d8591] border-t border-[#e3e8ee] pt-3">
            <span>OpenAI call: <b className="text-[#173f76]">{result.ms}ms</b></span>
            <span>Total round trip: <b className="text-[#173f76]">{result.roundTripMs}ms</b></span>
          </div>
        </div>
      )}
    </div>
  );
}

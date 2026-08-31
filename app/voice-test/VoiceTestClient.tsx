"use client";
import { useRef, useState } from "react";

type Status = "idle" | "recording" | "uploading" | "done" | "error";
type ProviderResult = { text: string; ms: number; roundTripMs: number };
type Provider = { key: string; label: string; endpoint: string };

const PROVIDERS: Provider[] = [
  { key: "openai", label: "OpenAI (Whisper-1)", endpoint: "/api/voice-test" },
  { key: "deepgram", label: "Deepgram (keyword-boosted)", endpoint: "/api/voice-test-deepgram" },
];

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
  const [micError, setMicError] = useState("");
  const [results, setResults] = useState<Record<string, ProviderResult | null>>({});
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function start() {
    setMicError(""); setResults({}); setProviderErrors({});
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error"); setMicError("This browser doesn't support microphone recording."); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => void uploadToAll(new Blob(chunksRef.current, { type: mimeType || "audio/webm" }));
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
      setStatus("recording");
    } catch (err) {
      setStatus("error"); setMicError(describeMicError(err));
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    setStatus("uploading");
  }

  async function transcribeWith(provider: Provider, blob: Blob) {
    const clientStart = Date.now();
    try {
      const form = new FormData();
      form.append("audio", blob, "clip");
      const res = await fetch(provider.endpoint, { method: "POST", body: form });
      const data = await res.json() as { text?: string; ms?: number; error?: string };
      if (!res.ok) {
        setProviderErrors(p => ({ ...p, [provider.key]: data.error || "Transcription failed" }));
        return;
      }
      setResults(r => ({ ...r, [provider.key]: { text: data.text || "", ms: data.ms || 0, roundTripMs: Date.now() - clientStart } }));
    } catch {
      setProviderErrors(p => ({ ...p, [provider.key]: "Upload failed — check your connection." }));
    }
  }

  async function uploadToAll(blob: Blob) {
    await Promise.allSettled(PROVIDERS.map(p => transcribeWith(p, blob)));
    setStatus("done");
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">AI CAPTURE — TEST</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-2 mb-1">Speech-to-text try-out</h1>
      <p className="text-[#697181] mb-6">Say a task out loud — include a name or project so we can see how it&apos;s transcribed. Records once, sends to both providers so you can compare them directly. This is a throwaway test page, nothing here is saved as a task.</p>

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

      {micError && (
        <div className="border border-[#e2a39c] bg-[#fdf1ef] text-[#a84235] rounded-lg p-4 text-sm mb-6">{micError}</div>
      )}

      {(Object.keys(results).length > 0 || Object.keys(providerErrors).length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PROVIDERS.map(provider => {
            const result = results[provider.key];
            const err = providerErrors[provider.key];
            return (
              <div key={provider.key} className="border border-[#e3e8ee] bg-white rounded-lg p-5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-[#8b929d] mb-2">{provider.label}</div>
                {err && <p className="text-sm text-[#a84235]">{err}</p>}
                {!err && !result && <p className="text-sm text-[#9299a3]">Waiting…</p>}
                {result && (
                  <>
                    <p className="text-base leading-relaxed text-[#202735] whitespace-pre-wrap mb-4">{result.text || "(empty — nothing recognized)"}</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#7d8591] border-t border-[#e3e8ee] pt-3">
                      <span>AI call: <b className="text-[#173f76]">{result.ms}ms</b></span>
                      <span>Round trip: <b className="text-[#173f76]">{result.roundTripMs}ms</b></span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

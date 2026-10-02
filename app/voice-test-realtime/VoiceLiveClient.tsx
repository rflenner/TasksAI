"use client";
import { useRef, useState } from "react";

type Status = "idle" | "connecting" | "connected" | "error";
type LogEntry = { role: "you" | "task-ai"; text: string };

// Same error-naming approach as app/voice-test/VoiceTestClient.tsx — a
// flattened "denied or unavailable" message is useless for telling a
// real permission block apart from a busy/missing device.
function describeMicError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  const hint =
    name === "NotAllowedError" ? "permission was denied — check the site and OS microphone settings." :
    name === "NotFoundError" ? "no microphone was found — check a mic is connected and selected as input." :
    name === "NotReadableError" ? "the microphone is in use or unreachable — try closing other apps that use audio and retry." :
    name === "SecurityError" ? "this page isn't considered secure enough for mic access — make sure you're on https://." :
    "an unexpected error occurred.";
  return name ? `Microphone error (${name}): ${hint}` : "Microphone access was denied or unavailable.";
}

export default function VoiceLiveClient() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function appendLog(entry: LogEntry) { setLog(l => [...l, entry]); }

  function teardown() {
    dcRef.current?.close(); dcRef.current = null;
    pcRef.current?.close(); pcRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
  }

  // The realtime model never touches Task AI's data itself — it just
  // calls this one tool with what the person said, exactly like a
  // typed/transcribed question would hit /api/voice-query from the
  // existing Ask Task AI. Same auth (the page's own session cookie),
  // same permission checks, same every-return-path-has-spokenAnswer
  // response shape — this function's only job is bridging that result
  // back into the realtime session as the tool's output so the model
  // can speak it.
  async function runTool(callId: string, name: string, argsJson: string) {
    if (name !== "ask_task_ai") return;
    let utterance = "";
    try { utterance = (JSON.parse(argsJson) as { utterance?: string }).utterance || ""; } catch { /* leave blank, handled below */ }
    appendLog({ role: "you", text: utterance || "(unclear)" });

    let spokenAnswer = "Sorry, something went wrong looking that up.";
    try {
      const res = await fetch("/api/voice-query", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: utterance }),
      });
      const data = await res.json() as { spokenAnswer?: string };
      if (data.spokenAnswer) spokenAnswer = data.spokenAnswer;
    } catch { /* keep the fallback message above */ }
    appendLog({ role: "task-ai", text: spokenAnswer });

    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ spokenAnswer }) },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  async function start() {
    setError(""); setLog([]); setStatus("connecting");
    try {
      const sessionRes = await fetch("/api/voice-test-realtime/session", { method: "POST" });
      const session = await sessionRes.json() as { clientSecret?: string; error?: string };
      if (!session.clientSecret) throw new Error(session.error || "Could not start a realtime session");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.ontrack = event => { if (audioRef.current) audioRef.current.srcObject = event.streams[0]; };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = event => {
        let msg: { type?: string; call_id?: string; name?: string; arguments?: string } = {};
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === "response.function_call_arguments.done" && msg.call_id && msg.name && msg.arguments !== undefined) {
          void runTool(msg.call_id, msg.name, msg.arguments);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // No ?model= or other query params here — the model is already
      // bound to the ephemeral client secret at mint time (see the
      // session route), and OpenAI's own current docs show this exact
      // endpoint/header shape with nothing else attached.
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { authorization: `Bearer ${session.clientSecret}`, "content-type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdpRes.ok) throw new Error(`Realtime connection failed (${sdpRes.status})`);
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

      setStatus("connected");
    } catch (err) {
      teardown();
      setStatus("error");
      setError(err instanceof DOMException ? describeMicError(err) : err instanceof Error ? err.message : "Could not start the live session.");
    }
  }

  function stop() {
    teardown();
    setStatus("idle");
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">AI CAPTURE — TEST</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-2 mb-1">Ask Task AI — GPT Realtime</h1>
      <p className="text-[#697181] mb-6">
        A side-by-side alternative to the Deepgram-based Ask Task AI — true voice-to-voice (OpenAI&apos;s Realtime API) instead of record → transcribe → classify → speak. The same Task AI logic answers every question either way; only how audio gets in and out is different here. Throwaway test page — talk naturally, try interrupting it, see how the latency and back-and-forth actually feel.
      </p>

      <div className="flex items-center gap-3 mb-6">
        {status !== "connected" && status !== "connecting" ? (
          <button onClick={() => void start()} className="h-11 px-5 rounded-lg font-bold text-white bg-[#173f76]">🎙️ Start talking</button>
        ) : (
          <button onClick={stop} disabled={status === "connecting"} className="h-11 px-5 rounded-lg font-bold text-white bg-[#c96539] disabled:opacity-50">
            {status === "connecting" ? "Connecting…" : "■ Stop"}
          </button>
        )}
        {status === "connected" && <span className="text-sm text-[#25784b] font-bold">● live</span>}
      </div>

      {error && <div className="border border-[#e2a39c] bg-[#fdf1ef] text-[#a84235] rounded-lg p-4 text-sm mb-6">{error}</div>}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live two-way voice audio, nothing to caption */}
      <audio ref={audioRef} autoPlay />

      {log.length > 0 && (
        <div className="border border-[#e3e8ee] bg-white rounded-lg p-5 space-y-3">
          {log.map((entry, i) => (
            <div key={i}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8b929d]">{entry.role === "you" ? "You asked" : "Task AI"}</div>
              <div className="text-sm text-[#202735]">{entry.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

// Reads dictated/edited text back with Deepgram's TTS (Aura) so it can be
// proofread by ear before creating the task. Proxies the same way the
// transcription routes do — the browser never sees the Deepgram key —
// but this one streams audio bytes back instead of JSON.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ error: "Voice capture isn't configured yet", code: "ai_unavailable" }, { status: 503 });

  const { text } = await request.json() as { text?: string };
  if (!text?.trim()) return Response.json({ error: "No text to read" }, { status: 400 });
  if (text.length > 2000) return Response.json({ error: "Text is too long to read back" }, { status: 413 });

  const voice = process.env.DEEPGRAM_TTS_VOICE || "aura-drew-en";
  const response = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return Response.json({ error: `Could not generate speech${detail ? `: ${detail.slice(0, 200)}` : ""}`, code: "ai_failed" }, { status: 502 });
  }
  const audio = await response.arrayBuffer();
  return new Response(audio, { headers: { "content-type": response.headers.get("content-type") || "audio/mpeg" } });
}

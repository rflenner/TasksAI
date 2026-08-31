import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";

// Throwaway endpoint for trying out speech-to-text before we design the
// real voice-capture flow. Takes a short recorded clip, sends it straight
// to OpenAI's transcription endpoint, and reports back the text plus how
// long the AI call itself took — so we can see accuracy and latency with
// real names/projects before building anything permanent around it. No
// glossary hinting here yet; that's the next step once this proves out.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured", code: "ai_unavailable" }, { status: 503 });

  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "No audio received" }, { status: 400 });
  if (audio.size > 15_000_000) return Response.json({ error: "Recording is too long" }, { status: 413 });

  const outgoing = new FormData();
  const ext = (audio.type.split("/")[1] || "webm").split(";")[0];
  outgoing.append("file", audio, `clip.${ext}`);
  outgoing.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe");

  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: outgoing,
  });
  const ms = Date.now() - started;
  if (!response.ok) return Response.json({ error: "Transcription failed", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { text?: string };
  return Response.json({ text: result.text || "", ms });
}

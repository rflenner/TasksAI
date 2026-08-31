import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";

// Same job as /api/voice-test, against Deepgram instead of OpenAI, so the
// test page can compare the two on the exact same recording. Deepgram's
// pre-recorded endpoint takes the raw audio bytes as the body (not
// multipart) with the content-type set to the audio's mimetype, unlike
// OpenAI's endpoint which wants a multipart file upload.

// Hardcoded stand-in for the real glossary (the dimensionValues table —
// people/projects/topics/meetings the app already tracks). Nova-3 supports
// "Keyterm Prompting" via a repeated `keyterm` param — the newer, more
// effective mechanism for exactly this: multi-word proper nouns a general
// model has no way to already know. Here purely to validate whether
// boosting actually fixes the misses a plain pass produced (Surendra ->
// Sorendra, Flenner -> Flanna) before wiring it up to real dimensionValues
// data and making it per-request instead of fixed.
const TEST_KEYTERMS = ["SalesAI", "Rizan Flenner", "Surendra Kumar"];

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ error: "Deepgram is not configured", code: "ai_unavailable" }, { status: 503 });

  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "No audio received" }, { status: 400 });
  if (audio.size > 15_000_000) return Response.json({ error: "Recording is too long" }, { status: 413 });

  const model = process.env.DEEPGRAM_MODEL || "nova-3";
  const params = new URLSearchParams({ model, smart_format: "true", punctuate: "true" });
  for (const term of TEST_KEYTERMS) params.append("keyterm", term);
  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;

  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": audio.type || "audio/webm" },
    body: audio,
  });
  const ms = Date.now() - started;
  if (!response.ok) return Response.json({ error: "Transcription failed", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
  const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return Response.json({ text, ms });
}

import { getDb } from "../../../db";
import { dimensionValues } from "../../../db/schema";
import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";

// Speech capture for the "Dictate task" button in the AI Capture drawer.
// Same shape as the /voice-test comparison route, but production-facing:
// pulls the real glossary (people/projects/topics/meetings the app
// already tracks in dimension_values) from the database on every request
// instead of a hardcoded test list, so a newly added name gets boosted
// automatically with no deploy. Nova-3's Keyterm Prompting is what makes
// this worth doing — it noticeably improved accuracy on real names in
// testing (see PR history) compared to a plain, unhinted pass.
//
// KEYTERM_LIMIT is a pragmatic cap, not a product decision: Keyterm
// Prompting is meant for a curated list, not an unbounded one. An org
// with a very large glossary would eventually want a smarter selection
// (most-recently-used, or scoped to the current view) instead of "all of
// them" — not a problem this app has yet.
const KEYTERM_LIMIT = 100;

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ error: "Voice capture isn't configured yet", code: "ai_unavailable" }, { status: 503 });

  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "No audio received" }, { status: 400 });
  if (audio.size > 15_000_000) return Response.json({ error: "Recording is too long" }, { status: 413 });

  const glossary = await getDb().select({ value: dimensionValues.value }).from(dimensionValues).limit(KEYTERM_LIMIT);

  const model = process.env.DEEPGRAM_MODEL || "nova-3";
  const params = new URLSearchParams({ model, smart_format: "true", punctuate: "true" });
  for (const row of glossary) params.append("keyterm", row.value);
  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": audio.type || "audio/webm" },
    body: audio,
  });
  if (!response.ok) return Response.json({ error: "Transcription failed", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
  const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return Response.json({ text });
}

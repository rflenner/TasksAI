import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

// Mints a short-lived (~1 minute) client secret the browser uses to open
// a direct WebRTC connection to OpenAI's Realtime API — the backend for
// the "Live Voice Assistant" button (app/components/VoiceAskRealtime.tsx),
// sitting alongside the existing Deepgram-based "Ask Task AI" rather than
// replacing it (requested 2026-10-02, after trying /voice-test-realtime,
// the throwaway comparison page this route was first proven against —
// that page still exists and now points here too, so there's exactly one
// place this mint logic lives).
//
// Session config (model/voice/instructions/tools) is set HERE, at mint
// time, via OpenAI's POST /v1/realtime/client_secrets — not something the
// browser can send afterward, so nothing running in a signed-in user's
// dev tools can swap the model or add tools. Confirmed against OpenAI's
// current (Oct 2026) docs: the old POST /v1/realtime/sessions beta
// endpoint was retired; this is the GA replacement, and unlike app/api/
// dictate/token's Deepgram key (which has to hand out the real, long-
// lived project key because that account's key lacks the keys:write
// scope needed for Deepgram's own short-lived keys), the real
// OPENAI_API_KEY never reaches the browser here at all.
//
// One tool only: ask_task_ai. The realtime model's whole job is holding
// a natural voice conversation and calling this whenever the person
// wants something looked up or changed — every bit of actual thinking
// (classify, permission checks, DB reads/writes, the notify/checklist/
// filter/act modes) stays exactly where it already lives, in
// /api/voice-query, completely unchanged. Deliberately the smallest
// possible bridge, not a parallel reimplementation of app/lib/
// voice-query.ts's logic as realtime tools — see that route's own
// comment for why a true multi-turn session was deferred as long as it
// was, and app/components/VoiceAskRealtime.tsx for how the bridge works.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured", code: "ai_unavailable" }, { status: 503 });

  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
  const voice = process.env.OPENAI_REALTIME_VOICE || "marin";
  // Transcribes what the PERSON said, purely for the voice audit trail
  // (app/lib/voice-audit.ts) — the realtime model hears the audio itself
  // and never sees this text, so it can differ from what the model
  // understood; the audit shows both side by side on purpose, since a
  // mismatch is exactly the kind of thing worth being able to spot.
  // whisper-1 is deprecated (removal announced for Feb 2027), so this
  // defaults to the model OpenAI now recommends instead.
  const transcribeModel = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || "gpt-transcribe";

  const mint = (withTranscription: boolean) => fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        audio: { ...(withTranscription ? { input: { transcription: { model: transcribeModel } } } : {}), output: { voice } },
        instructions: "You are Task AI's voice assistant, in a live spoken conversation. Keep replies short and conversational — this is being spoken aloud, not read. Whenever the person asks about their tasks, wants to filter or find something, wants to change or create a task, check off a checklist item, or wants to notify/remind someone connected to a task, call ask_task_ai with what they said, close to their own words rather than your own paraphrase. When ask_task_ai returns, speak its spokenAnswer back — a light rephrase for natural speech is fine, but never change the facts in it. Never say that you changed, created, sent or checked off anything unless ask_task_ai just told you it happened. If spokenAnswer asks a yes/no question (like confirming before sending a notification or deleting a task), ask it and wait for their answer, then call ask_task_ai again with exactly what they said in reply.",
        tools: [{
          type: "function",
          name: "ask_task_ai",
          description: "Looks up, filters, creates, or changes Task AI tasks on the person's behalf — including checklist items and notifying someone connected to a task. Pass their request close to their own words.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { utterance: { type: "string", description: "What the person just said, close to verbatim." } },
            required: ["utterance"],
          },
        }],
      },
    }),
  });

  // The audit transcription is a debugging add-on, never a reason the
  // assistant itself fails to start: if OpenAI rejects the session with
  // it (an unavailable model, say), retry once without it.
  let response = await mint(true);
  if (!response.ok) response = await mint(false);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return Response.json({ error: `Could not start a realtime session${detail ? `: ${detail.slice(0, 300)}` : ""}`, code: "ai_failed" }, { status: 502 });
  }
  const result = await response.json() as { value?: string; client_secret?: { value?: string } };
  const clientSecret = result.client_secret?.value || result.value;
  if (!clientSecret) return Response.json({ error: "Realtime API did not return a client secret", code: "ai_failed" }, { status: 502 });
  return Response.json({ clientSecret, model });
}

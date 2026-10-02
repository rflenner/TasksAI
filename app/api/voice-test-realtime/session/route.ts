import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

// Mints a short-lived (~1 minute) client secret the browser uses to open
// a direct WebRTC connection to OpenAI's Realtime API ("GPT Live") — the
// true voice-to-voice alternative to the existing Deepgram-based Ask
// Task AI (app/api/voice-query/route.ts's own comment explains that
// pipeline was deliberately built AROUND avoiding exactly this kind of
// always-open, continuously-billed session; this page is for actually
// trying the alternative, not replacing anything yet).
//
// Session config (model/voice/instructions/tools) is set HERE, at mint
// time, via OpenAI's POST /v1/realtime/client_secrets — not something
// the browser can send afterward, so nothing running in a signed-in
// user's dev tools can swap the model or add tools. Confirmed against
// OpenAI's current (Oct 2026) docs: the old POST /v1/realtime/sessions
// beta endpoint was retired; this is the GA replacement, and unlike
// app/api/dictate/token's Deepgram key (which has to hand out the real,
// long-lived project key because that account's key lacks the
// keys:write scope needed for Deepgram's own short-lived keys), the real
// OPENAI_API_KEY never reaches the browser here at all.
//
// One tool only: ask_task_ai. The realtime model's whole job is holding
// a natural voice conversation and calling this whenever the person
// wants something looked up or changed — every bit of actual thinking
// (classify, permission checks, DB reads/writes) stays exactly where it
// already lives, in /api/voice-query, completely unchanged. Deliberately
// the smallest possible bridge, not a parallel reimplementation of
// app/lib/voice-query.ts's logic as realtime tools.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured", code: "ai_unavailable" }, { status: 503 });

  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
  const voice = process.env.OPENAI_REALTIME_VOICE || "marin";

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        audio: { output: { voice } },
        instructions: "You are Task AI's voice assistant, in a live spoken conversation. Keep replies short and conversational — this is being spoken aloud, not read. Whenever the person asks about their tasks, wants to filter or find something, or wants to change or create a task, call ask_task_ai with what they said, close to their own words rather than your own paraphrase. When ask_task_ai returns, speak its spokenAnswer back — a light rephrase for natural speech is fine, but never change the facts in it.",
        tools: [{
          type: "function",
          name: "ask_task_ai",
          description: "Looks up, filters, creates, or changes Task AI tasks on the person's behalf. Pass their request close to their own words.",
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
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return Response.json({ error: `Could not start a realtime session${detail ? `: ${detail.slice(0, 300)}` : ""}`, code: "ai_failed" }, { status: 502 });
  }
  const result = await response.json() as { value?: string; client_secret?: { value?: string } };
  const clientSecret = result.client_secret?.value || result.value;
  if (!clientSecret) return Response.json({ error: "Realtime API did not return a client secret", code: "ai_failed" }, { status: 502 });
  return Response.json({ clientSecret, model });
}

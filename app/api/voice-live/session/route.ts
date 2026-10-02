import { getDb } from "../../../../db";
import { tasks } from "../../../../db/schema";
import { canSeeTask } from "../../../lib/permissions";
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
// Two tools: ask_task_ai (everything) and next_task (a dedicated, no-
// classification shortcut for walking a list — added 2026-10-02 because
// "next" routed through the classifier kept restarting the walk).
// Originally one tool only: ask_task_ai. The realtime model's whole job is holding
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
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
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

  // The names that come up on this person's tasks, so the model hears
  // them right — a live audit (2026-10-02) had "Drew Klein" heard as
  // "Brew Client". Only people on tasks they can already see (the same
  // canSeeTask scoping as /api/voice-query), never the whole user list.
  const rows = await getDb().select({ owner: tasks.owner, collaborators: tasks.collaborators, recipients: tasks.recipients, project: tasks.project, topic: tasks.topic, recurringMeeting: tasks.recurringMeeting, mergedIntoTaskId: tasks.mergedIntoTaskId }).from(tasks);
  const names = [...new Set(rows.filter(t => !t.mergedIntoTaskId && canSeeTask(t, actor)).flatMap(t => [t.owner, ...t.collaborators, ...t.recipients]).map(n => String(n || "").trim()).filter(n => n && n.length <= 60))].slice(0, 150);
  const namesText = names.length ? ` Names you may hear (spell them exactly like this when you pass on what the person said): ${names.join(", ")}.` : "";

  const mint = (withTranscription: boolean) => fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        audio: { ...(withTranscription ? { input: { transcription: { model: transcribeModel } } } : {}), output: { voice } },
        // Rewritten 2026-10-02 after a live audit showed the model (a)
        // answering task questions from its own head instead of calling
        // Task AI, (b) rewording what the person said before passing it on
        // (so Task AI lost "my"/"overdue"), (c) chatting before the tool
        // returned and then colliding with the tool's own answer, and
        // (d) paraphrasing a send-this-message confirmation.
        instructions: "You are Task AI's voice assistant, in a live spoken conversation with a colleague. Keep every reply short and natural — it is spoken aloud. You know nothing about their tasks yourself and never answer a question about tasks, people, due dates, lists or checklists from your own knowledge. For anything about tasks — looking something up, filtering, opening or reading a task, creating or changing one, checklist items, notifying someone — call ask_task_ai straight away. Do not say anything before calling it (no 'let me check', no 'sure'), and pass what the person said as close to word for word as you can, even when it is only a fragment like 'the first one', 'yes' or 'no, send it to Maya instead'. Never reword it, expand it or fill in details they did not say: Task AI keeps track of the list on their screen and of the task they are looking at, and works that out itself. When the person says 'next', 'next one', 'next task', 'skip this one' or 'what's next', call next_task instead. When a tool returns, speak its spokenAnswer: you may smooth the wording for speech but never change, add or drop a fact, name, date, number or count, and never add facts of your own. If spokenAnswer asks a question (confirming a message before it is sent, or a delete), read the question aloud exactly — including any message in quotes — then wait, and pass their reply to ask_task_ai word for word. Never say anything was changed, created, sent or checked off unless a tool result says so; if a result says something could not be done, say that plainly. Only greet the person when you are explicitly asked to. No small talk and no enthusiasm or filler ('Haha', 'So nice to chat', 'Awesome!'): when nothing needs doing, answer in one short sentence or simply say 'Okay.' If the person is clearly talking to someone else in the room or thinking aloud ('let me check', 'interesting', 'hmm', a question addressed to another person by name), do not call a tool and do not answer — at most say 'Okay.'" + namesText,
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
        }, {
          type: "function",
          name: "next_task",
          description: "Moves on to the next task of the list the person is working through and reads it out. Use for 'next', 'next one', 'next task', 'skip this one', 'what's next'. Takes no arguments.",
          parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
        }],
      },
    }),
  });

  // The audit transcription is a debugging add-on, never a reason the
  // assistant itself fails to start: if OpenAI rejects the session with
  // it (an unavailable model, say), retry once without it.
  let withTranscription = true;
  let response = await mint(true);
  if (!response.ok) { withTranscription = false; response = await mint(false); }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return Response.json({ error: `Could not start a realtime session${detail ? `: ${detail.slice(0, 300)}` : ""}`, code: "ai_failed" }, { status: 502 });
  }
  const result = await response.json() as { value?: string; client_secret?: { value?: string } };
  const clientSecret = result.client_secret?.value || result.value;
  if (!clientSecret) return Response.json({ error: "Realtime API did not return a client secret", code: "ai_failed" }, { status: 502 });
  // The first name lets the assistant greet the person by name ("Hi Rizan, …").
  const firstName = actor.name.trim().split(/\s+/)[0] || "";
  return Response.json({ clientSecret, model, transcription: withTranscription, firstName });
}

import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { closePlanDocuments } from "../../../../../db/schema";
import { capabilities } from "../../../../lib/close-plan-voice";
import { canAccessPlan } from "../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../lib/request";
import { currentActor } from "../../../../lib/session";

export const dynamic = "force-dynamic";

// Starts a live voice session for one close plan (the Close Plan page's voice
// assistant). Same OpenAI Realtime set-up as the Task AI Live Voice Assistant
// (app/api/voice-live/session/route.ts), with close-plan instructions and two
// tools the page answers through /api/close-plans/voice: ask_close_plan
// (everything) and next_item (walking a list). The real OPENAI_API_KEY never
// reaches the browser; it gets a short-lived client secret.
const INSTRUCTIONS = "You are the voice assistant for a close plan in Task AI: a shared plan between iSEEit (the seller) and a customer, with phases, tasks, subtasks, milestones and people on both sides. Keep every reply short and natural, it is spoken aloud. You know nothing about the plan yourself and never answer from your own knowledge. For anything about the plan (where it stands, what's next, what to do, a task, a phase, a person, dates; opening or showing tasks; changing, closing or adding tasks) call ask_close_plan straight away, without saying anything first, and pass what the person said as close to word for word as you can, even fragments like 'the second one', 'yes' or 'no, Friday'. Never reword it or fill in details they didn't say. When they say 'next', 'next one' or 'skip this one', call next_item instead. When a tool returns, speak its spokenAnswer: you may smooth the wording for speech but never change, add or drop a fact, name, date or number. If spokenAnswer asks a question, read it aloud exactly, wait, and pass the reply to ask_close_plan word for word. Never say anything was changed unless a tool result says so. No small talk and no filler ('Haha', 'Awesome!'): when nothing needs doing, answer in one short sentence or just say 'Okay.' If the person is clearly talking to someone else or thinking aloud, don't call a tool and don't answer. Only greet the person when you are explicitly asked to.";

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured" }, { status: 503 });
  const body = await request.json().catch(() => null) as { planId?: unknown } | null;
  const planId = typeof body?.planId === "string" ? body.planId : "";
  const [row] = planId ? await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, planId)).limit(1) : [];
  if (!row || row.deletedAt || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });

  // The plan's people, so their names are heard right.
  const people = Array.isArray(row.data.people) ? row.data.people as Array<{ name?: unknown }> : [];
  const names = [...new Set(people.map(p => String(p.name || "").trim()).filter(n => n && n.length <= 60))].slice(0, 80);
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
  const voice = process.env.OPENAI_REALTIME_VOICE || "marin";
  const transcribeModel = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || "gpt-transcribe";
  const mint = (withTranscription: boolean) => fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime", model,
        audio: { ...(withTranscription ? { input: { transcription: { model: transcribeModel } } } : {}), output: { voice } },
        instructions: INSTRUCTIONS + (names.length ? ` People on this plan (spell them exactly like this): ${names.join(", ")}.` : ""),
        tools: [{
          type: "function", name: "ask_close_plan",
          description: "Ask the close plan anything or tell it to do something: where things stand, what's next, open/show tasks, change, close or add tasks. Pass the person's words verbatim.",
          parameters: { type: "object", additionalProperties: false, properties: { utterance: { type: "string", description: "What the person just said, close to verbatim." } }, required: ["utterance"] },
        }, {
          type: "function", name: "next_item",
          description: "Moves on to the next task of the list being walked and reads it out. For 'next', 'next one', 'skip this one'.",
          parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
        }],
      },
    }),
  });
  let withTranscription = true;
  let response = await mint(true);
  if (!response.ok) { withTranscription = false; response = await mint(false); }
  if (!response.ok) return Response.json({ error: "Could not start a voice session" }, { status: 502 });
  const result = await response.json() as { value?: string; client_secret?: { value?: string } };
  const clientSecret = result.client_secret?.value || result.value;
  if (!clientSecret) return Response.json({ error: "Could not start a voice session" }, { status: 502 });
  // The "What can I say?" list, filled in with this plan's names.
  const d = row.data as { account?: unknown; phases?: Array<{ name?: unknown; start?: unknown; end?: unknown }>; people?: Array<{ name?: unknown; side?: unknown }> };
  const today = new Date().toISOString().slice(0, 10);
  const phase = (d.phases || []).find(p => String(p.start) <= today && today <= String(p.end)) || (d.phases || [])[0];
  const person = (d.people || []).find(p => p.side === "seller" && String(p.name || "").split(" ")[0] !== actor.name.split(" ")[0]);
  const list = capabilities(String(d.account || "the customer"), String(phase?.name || "this phase"), String(person?.name || "Drew").split(" ")[0]);
  return Response.json({ clientSecret, model, transcription: withTranscription, firstName: actor.name.trim().split(/\s+/)[0] || "", capabilities: list });
}

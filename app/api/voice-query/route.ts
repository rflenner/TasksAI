import { getDb } from "../../../db";
import { tasks } from "../../../db/schema";
import { canSeeTask } from "../../lib/permissions";
import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";

// The lightweight alternative to Deepgram's bundled Voice Agent product
// (STT+LLM+TTS+function-calling over one always-open, ~$4.50/hr
// WebSocket session): this app already has real-time STT (app/api/
// dictate/token) and TTS (app/api/dictate/speak) for the existing
// dictation feature, both billed per-use, not per-session. All that was
// missing for "ask a question, hear an answer, see an action" was this
// one classify-and-ground step — a single request/response call, same
// shape (and same OpenAI Responses API + strict JSON Schema pattern) as
// app/lib/task-extraction.ts, just answering a different kind of
// question. No new vendor, no new pricing model, no open session to
// manage — the tradeoff is no true multi-turn conversation (each
// utterance is independent), which is fine for single-shot commands
// like "what are my tasks this week" and not worth the cost until real
// back-and-forth ("no, the other project") is actually needed.
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "filters", "answer"],
  properties: {
    mode: { type: "string", enum: ["filter", "answer", "unclear"] },
    filters: {
      type: "object",
      additionalProperties: false,
      required: ["owner", "mineOnly", "project", "topic", "recurringMeeting", "priority", "dueWithin", "status"],
      properties: {
        owner: { type: ["string", "null"] },
        mineOnly: { type: "boolean" },
        project: { type: ["string", "null"] },
        topic: { type: ["string", "null"] },
        recurringMeeting: { type: ["string", "null"] },
        priority: { type: ["string", "null"], enum: ["Low", "Medium", "High", null] },
        dueWithin: { type: ["string", "null"], enum: ["week", "overdue", null] },
        status: { type: ["string", "null"], enum: ["Open", "In progress", "Closed", null] },
      },
    },
    answer: { type: "string" },
  },
};

type Filters = {
  owner: string | null; mineOnly: boolean; project: string | null; topic: string | null; recurringMeeting: string | null;
  priority: "Low" | "Medium" | "High" | null; dueWithin: "week" | "overdue" | null; status: string | null;
};

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { transcript } = await request.json().catch(() => ({})) as { transcript?: string };
  if (!transcript?.trim()) return Response.json({ error: "Nothing was asked" }, { status: 400 });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured", code: "ai_unavailable" }, { status: 503 });

  // Never the whole tasks table — the same canSeeTask scoping every
  // other read path enforces, so the assistant can't answer a question
  // (or report a count) about anything the asking user couldn't already
  // see in the UI. Capped at 200 for prompt size; a real per-query
  // retrieval step would be the next improvement if that cap ever bites.
  const all = await getDb().select().from(tasks);
  const visible = all.filter(task => canSeeTask(task, actor));
  const summary = visible.slice(0, 200).map(t => ({
    id: t.id, subject: t.subject, owner: t.owner, collaborators: t.collaborators, recipients: t.recipients,
    due: t.due, status: t.status, priority: t.priority, project: t.project, topic: t.topic, recurringMeeting: t.recurringMeeting,
    source: t.source, updateCount: t.updates.length, lastUpdate: t.updates.length ? t.updates[t.updates.length - 1].text : null,
  }));
  const today = new Date().toISOString().slice(0, 10);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: [{
        role: "system", content: `You are Task AI's voice assistant, answering a spoken question from ${actor.name} (role: ${actor.role}). Today's date is ${today}.
You are given the JSON list of every task ${actor.name} can currently see in Task AI — already permission-filtered, so never claim knowledge of anything outside it.
Decide exactly one of:
- "filter": the user wants the on-screen task list narrowed down ("show me tasks with Shankar", "what's due this week", "high priority tasks in the pilot project"). Fill in filters with whatever criteria apply; leave answer as an empty string — the caller generates the spoken confirmation itself from the real filtered count, never trust a count you say here.
- "answer": a factual question the task data can answer ("is anyone overdue on the pilot", "what's the latest update on the CRM task", "how many tasks does Shankar have"). Put the answer in answer, grounded ONLY in the provided data — never invent a task, person, or detail not present in it. Leave every filters field null/false.
- "unclear": neither fits. Leave answer as an empty string.
For owner names, prefer the exact spelling from the task data's owner field when you can tell which person is meant; a first name or close match is fine otherwise — the caller does its own matching. If the user refers to their own tasks ("my tasks", "what do I have"), set mineOnly true and leave owner null.`,
      }, {
        role: "user", content: `Visible tasks:\n${JSON.stringify(summary)}\n\nSpoken question: ${transcript}`,
      }],
      text: { format: { type: "json_schema", name: "voice_query", strict: true, schema } },
    }),
  });
  if (!response.ok) return Response.json({ error: "Could not understand that", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const outputText = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  let parsed: { mode: "filter" | "answer" | "unclear"; filters: Filters; answer: string };
  try { parsed = JSON.parse(outputText); } catch { return Response.json({ error: "Could not understand that", code: "ai_failed" }, { status: 502 }); }

  if (parsed.mode === "unclear") {
    return Response.json({ mode: "unclear", filters: null, spokenAnswer: parsed.answer || "I'm not sure what you're asking — try something like \"show me tasks with Shankar\" or \"what's overdue this week\"." });
  }
  if (parsed.mode === "answer") {
    return Response.json({ mode: "answer", filters: null, spokenAnswer: parsed.answer || "I couldn't find an answer to that." });
  }

  // mode === "filter": count matches ourselves against the same
  // permission-scoped list the model saw — the spoken confirmation
  // reports a real number, never one the model might have guessed at.
  const f = parsed.filters;
  const matches = visible.filter(t => {
    if (f.mineOnly && !(t.owner === actor.name || t.collaborators.includes(actor.name) || t.recipients.includes(actor.name))) return false;
    if (f.owner && t.owner.toLowerCase() !== f.owner.toLowerCase() && !t.owner.toLowerCase().includes(f.owner.toLowerCase())) return false;
    if (f.project && t.project !== f.project) return false;
    if (f.topic && t.topic !== f.topic) return false;
    if (f.recurringMeeting && t.recurringMeeting !== f.recurringMeeting) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.dueWithin === "overdue" && !(t.due && t.due < today && t.status !== "Closed")) return false;
    if (f.dueWithin === "week" && !(t.due && t.due >= today && t.due <= new Date(Date.now() + 6048e5).toISOString().slice(0, 10) && t.status !== "Closed")) return false;
    return true;
  });
  const parts: string[] = [];
  if (f.mineOnly) parts.push("your tasks"); else if (f.owner) parts.push(`tasks for ${f.owner}`); else parts.push("tasks");
  if (f.project) parts.push(`in ${f.project}`);
  if (f.topic) parts.push(`on ${f.topic}`);
  if (f.recurringMeeting) parts.push(`for ${f.recurringMeeting}`);
  if (f.priority) parts.push(`marked ${f.priority} priority`);
  if (f.status) parts.push(`with status ${f.status}`);
  if (f.dueWithin === "week") parts.push("due this week");
  if (f.dueWithin === "overdue") parts.push("that are overdue");
  const spokenAnswer = `Showing ${matches.length} ${parts.join(" ")}.`;

  return Response.json({ mode: "filter", filters: f, matchCount: matches.length, spokenAnswer });
}

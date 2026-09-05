import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sessions, tasks, users } from "../../../db/schema";
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
  required: ["mode", "filters", "navigateTarget", "answer"],
  properties: {
    mode: { type: "string", enum: ["filter", "answer", "navigate", "unclear"] },
    filters: {
      type: "object",
      additionalProperties: false,
      required: ["owner", "mineOnly", "project", "topic", "recurringMeeting", "priority", "dueWithin", "createdWithin", "closedWithin", "status"],
      properties: {
        owner: { type: ["string", "null"] },
        mineOnly: { type: "boolean" },
        project: { type: ["string", "null"] },
        topic: { type: ["string", "null"] },
        recurringMeeting: { type: ["string", "null"] },
        priority: { type: ["string", "null"], enum: ["Low", "Medium", "High", null] },
        dueWithin: { type: ["string", "null"], enum: ["week", "overdue", null] },
        createdWithin: { type: ["string", "null"], enum: ["today", null] },
        closedWithin: { type: ["string", "null"], enum: ["today", null] },
        status: { type: ["string", "null"], enum: ["Open", "In progress", "Closed", null] },
      },
    },
    // For mode="navigate" only — opening a specific screen/form rather
    // than answering or filtering ("open dictate task", "start a new
    // action item", "paste meeting minutes").
    navigateTarget: { type: ["string", "null"], enum: ["dictate", "new_task", "paste_minutes", null] },
    answer: { type: "string" },
  },
};

type Filters = {
  owner: string | null; mineOnly: boolean; project: string | null; topic: string | null; recurringMeeting: string | null;
  priority: "Low" | "Medium" | "High" | null; dueWithin: "week" | "overdue" | null;
  createdWithin: "today" | null; closedWithin: "today" | null; status: string | null;
};

// Same "how long ago" reasoning as the Users & access page's own
// lastActive() formatter, phrased for speech rather than a UI label —
// "about 3 hours ago" reads naturally out loud, "Active 3h ago" doesn't.
function describeLastActive(lastSeenAt: Date | null): string {
  if (!lastSeenAt) return "never signed in";
  const minutes = Math.round((Date.now() - lastSeenAt.getTime()) / 60000);
  if (minutes < 1) return "active just now";
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (minutes < 1440) { const hours = Math.round(minutes / 60); return `about ${hours} hour${hours === 1 ? "" : "s"} ago`; }
  const days = Math.round(minutes / 1440);
  if (days < 14) return `about ${days} day${days === 1 ? "" : "s"} ago`;
  return `on ${lastSeenAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
}

// Every raw date (due/created/closedAt) in the summary handed to the
// model comes with one of these alongside it — confirmed live
// 2026-09-04: asked about a due date, the model just echoed the raw
// "2026-09-07" back in its spoken answer, which Deepgram's TTS reads
// as something close to digit-by-digit rather than a real date. Same
// fix family as describeLastActive above: compute the natural phrase
// deterministically, then tell the model (below) to speak *this*, never
// the raw field — reasoning/sorting can still use the raw ISO date,
// only speech needs the human phrasing.
function speakableDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const iso = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = d.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const yearSuffix = d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : "";
  return `${weekday}, ${month} ${day}${suffix}${yearSuffix}`;
}

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
  // see in the UI. Capped at 200 for prompt size, but newest-first
  // (orderBy desc(id), same as GET /api/tasks) — confirmed live
  // 2026-09-04: without an explicit order, "which tasks were created
  // today" answered "none" while 12 genuinely existed, because the
  // unordered query happened to return an older 200 rows and today's
  // tasks fell outside the cap. A real per-query retrieval step would
  // be the next improvement if newest-200 ever isn't enough on its own.
  const all = await getDb().select().from(tasks).orderBy(desc(tasks.id));
  const visible = all.filter(task => canSeeTask(task, actor));
  const summary = visible.slice(0, 200).map(t => ({
    id: t.id, subject: t.subject, owner: t.owner, collaborators: t.collaborators, recipients: t.recipients,
    due: t.due, dueSpeakable: speakableDate(t.due), status: t.status, priority: t.priority, project: t.project, topic: t.topic, recurringMeeting: t.recurringMeeting,
    source: t.source, created: t.created, createdSpeakable: speakableDate(t.created),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null, closedSpeakable: t.closedAt ? speakableDate(t.closedAt.toISOString()) : null,
    updateCount: t.updates.length, lastUpdate: t.updates.length ? t.updates[t.updates.length - 1].text : null,
  }));
  const today = new Date().toISOString().slice(0, 10);

  // The exact spelling each project/meeting/topic is actually stored
  // under, derived only from tasks this actor can see (never the
  // unscoped full dimension list — that could leak an area-admin's
  // out-of-scope project names). Handed to the model so "Architecture
  // calls" resolves to whatever the real recurringMeeting string is,
  // rather than the model guessing at a slightly different spelling
  // that then matches nothing when the caller filters against it.
  const knownProjects = [...new Set(visible.map(t => t.project).filter(Boolean))];
  const knownTopics = [...new Set(visible.map(t => t.topic).filter(Boolean))];
  const knownMeetings = [...new Set(visible.map(t => t.recurringMeeting).filter(Boolean))];

  // Presence (last-active) data gets the exact same gate the Users &
  // access page itself uses (canInvite) — the assistant can't answer
  // "when was X last online" for anyone the asking user couldn't
  // already see that for in the real UI. An empty list here (not an
  // error) is how a Collaborator's assistant honestly has nothing to
  // answer that kind of question with.
  let people: Array<{ name: string; role: string; lastActive: string }> = [];
  if (actor.canInvite) {
    const userRows = await getDb().select({ id: users.id, name: users.name, role: users.role, status: users.status }).from(users).where(eq(users.status, "active"));
    const sessionRows = await getDb().select({ userId: sessions.userId, lastSeenAt: sessions.lastSeenAt }).from(sessions);
    const lastActiveByUser = new Map<number, Date>();
    for (const s of sessionRows) { const existing = lastActiveByUser.get(s.userId); if (!existing || s.lastSeenAt > existing) lastActiveByUser.set(s.userId, s.lastSeenAt); }
    // A relative phrase computed here, not left to the model — confirmed
    // live 2026-09-04: without this, "when was Drew last online" got
    // read back as the raw ISO timestamp verbatim, which reads (and
    // sounds, once spoken) completely broken.
    people = userRows.map(u => ({ name: u.name, role: u.role, lastActive: describeLastActive(lastActiveByUser.get(u.id) ?? null) }));
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: [{
        role: "system", content: `You are Task AI's voice assistant, answering a spoken question from ${actor.name} (role: ${actor.role}). Today's date is ${today}.
You are given the JSON list of every task ${actor.name} can currently see in Task AI — already permission-filtered, so never claim knowledge of a task outside it. You are also given, when available, a list of people with their role and a ready-to-speak lastActive phrase (e.g. "about 3 hours ago", "never signed in") — use that phrase exactly as given, never reformat or reinterpret it. If that list is empty, you have no presence data at all and must say so rather than guessing.
Every task's due/created/closedAt is a raw YYYY-MM-DD or ISO timestamp — fine for your own reasoning (sorting, comparing, deciding what's soonest or most recent) but NEVER speak one of those raw strings directly, it reads like nonsense out loud. Each one has a matching dueSpeakable/createdSpeakable/closedSpeakable field (e.g. "Monday, September 7th") right next to it — whenever your spoken answer mentions a date, use that speakable phrase verbatim instead, never the raw field. If the speakable field is null, that date genuinely isn't set — say so, don't invent one.
Known exact project names: ${JSON.stringify(knownProjects)}. Known exact recurring meeting names: ${JSON.stringify(knownMeetings)}. Known exact topic names: ${JSON.stringify(knownTopics)}. When the user refers to one of these by a close, partial, or differently-worded phrase, use the EXACT string from these lists in the matching filter field — never your own paraphrase of it.
Decide exactly one of:
- "filter": the user wants the on-screen task list narrowed down ("show me tasks with Shankar", "what's due this week", "high priority tasks in the pilot project", "open tasks for the Architecture calls meeting", "what got created today", "what closed today"). Fill in filters with whatever criteria apply; leave answer as an empty string — the caller generates the spoken confirmation itself from the real filtered count, never trust a count you say here.
- "answer": a factual question the task or people data can answer ("is anyone overdue on the pilot", "what's the latest update on the CRM task", "how many tasks does Shankar have", "when was Drew last online"). Put the answer in answer, grounded ONLY in the provided data — never invent a task, person, date, or detail not present in it. Leave every filters field null/false and navigateTarget null.
- "navigate": the user wants to open a specific screen or form, not ask about data — "open dictate task"/"let's dictate a task" -> "dictate"; "start a new action item"/"create a task" (with no content spoken to extract — if they're actually describing a task to create, that's not this app's job right now, treat it as unclear) -> "new_task"; "paste meeting minutes"/"open the minutes paster" -> "paste_minutes". Put the target in navigateTarget, leave answer empty and every filters field null/false.
- "unclear": none of the above fit. Leave answer as an empty string.
For owner names, prefer the exact spelling from the task data's owner field when you can tell which person is meant; a first name or close match is fine otherwise — the caller does its own matching. If the user refers to their own tasks ("my tasks", "what do I have"), set mineOnly true and leave owner null. "Created today"/"closed today" map to createdWithin/closedWithin "today" respectively.`,
      }, {
        role: "user", content: `Visible tasks:\n${JSON.stringify(summary)}\n\nPeople:\n${JSON.stringify(people)}\n\nSpoken question: ${transcript}`,
      }],
      text: { format: { type: "json_schema", name: "voice_query", strict: true, schema } },
    }),
  });
  if (!response.ok) return Response.json({ error: "Could not understand that", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const outputText = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  let parsed: { mode: "filter" | "answer" | "navigate" | "unclear"; filters: Filters; navigateTarget: "dictate" | "new_task" | "paste_minutes" | null; answer: string };
  try { parsed = JSON.parse(outputText); } catch { return Response.json({ error: "Could not understand that", code: "ai_failed" }, { status: 502 }); }

  if (parsed.mode === "unclear") {
    return Response.json({ mode: "unclear", filters: null, spokenAnswer: parsed.answer || "I'm not sure what you're asking — try something like \"show me tasks with Shankar\" or \"what's overdue this week\"." });
  }
  if (parsed.mode === "answer") {
    return Response.json({ mode: "answer", filters: null, spokenAnswer: parsed.answer || "I couldn't find an answer to that." });
  }
  if (parsed.mode === "navigate") {
    const label: Record<string, string> = { dictate: "Opening voice dictation.", new_task: "Opening a new action item.", paste_minutes: "Opening the meeting minutes paster." };
    if (!parsed.navigateTarget) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "I'm not sure what you'd like me to open." });
    return Response.json({ mode: "navigate", navigateTarget: parsed.navigateTarget, spokenAnswer: label[parsed.navigateTarget] });
  }

  // mode === "filter": count matches ourselves against the same
  // permission-scoped list the model saw — the spoken confirmation
  // reports a real number, never one the model might have guessed at.
  const f = parsed.filters;
  const weekAhead = new Date(Date.now() + 6048e5).toISOString().slice(0, 10);
  const matches = visible.filter(t => {
    if (f.mineOnly && !(t.owner === actor.name || t.collaborators.includes(actor.name) || t.recipients.includes(actor.name))) return false;
    if (f.owner && t.owner.toLowerCase() !== f.owner.toLowerCase() && !t.owner.toLowerCase().includes(f.owner.toLowerCase())) return false;
    if (f.project && t.project !== f.project) return false;
    if (f.topic && t.topic !== f.topic) return false;
    if (f.recurringMeeting && t.recurringMeeting !== f.recurringMeeting) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.dueWithin === "overdue" && !(t.due && t.due < today && t.status !== "Closed")) return false;
    if (f.dueWithin === "week" && !(t.due && t.due >= today && t.due <= weekAhead && t.status !== "Closed")) return false;
    if (f.createdWithin === "today" && t.created.slice(0, 10) !== today) return false;
    if (f.closedWithin === "today" && (!t.closedAt || t.closedAt.toISOString().slice(0, 10) !== today)) return false;
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
  if (f.createdWithin === "today") parts.push("created today");
  if (f.closedWithin === "today") parts.push("closed today");
  const spokenAnswer = `Showing ${matches.length} ${parts.join(" ")}.`;

  return Response.json({ mode: "filter", filters: f, matchCount: matches.length, spokenAnswer });
}

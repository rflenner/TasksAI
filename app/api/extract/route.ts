import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { pastedMinutes, users } from "../../../db/schema";
import { collapseToSingleTask, detectsMultiTaskTrigger } from "../../lib/dictate-intent";
import { resolveTaskNames } from "../../lib/name-resolution";
import { hashPastedMinutes } from "../../lib/pasted-minutes";
import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject","description","owner","collaborators","recipients","due","topic","project","recurringMeeting"],
        properties: {
          subject: { type: "string" }, description: { type: "string" },
          owner: { type: ["string","null"] }, collaborators: { type: "array", items: { type: "string" } }, recipients: { type: "array", items: { type: "string" } },
          due: { type: ["string","null"], description: "YYYY-MM-DD when known" }, topic: { type: ["string","null"] }, project: { type: ["string","null"] }, recurringMeeting: { type: ["string","null"] },
        },
      },
    },
  },
};

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { minutes, source, force } = await request.json() as { minutes?: string; source?: string; force?: boolean };
  if (!minutes?.trim()) return Response.json({ error: "Meeting minutes are required" }, { status: 400 });
  if (minutes.length > 120_000) return Response.json({ error: "Meeting minutes are too long" }, { status: 413 });

  // Dictation (app/dictate) shares this endpoint but is never checked for
  // duplicates — spoken text naturally varies run to run, so an exact-text
  // match there is far more likely to be a genuine repeat than an
  // accidental re-paste, unlike copy/pasting the same summary twice.
  const contentHash = source === "dictate" ? null : hashPastedMinutes(minutes);
  if (contentHash && !force) {
    const [existing] = await getDb().select().from(pastedMinutes).where(eq(pastedMinutes.contentHash, contentHash)).limit(1);
    if (existing) return Response.json({ duplicate: true, pastedAt: existing.createdAt.toISOString(), taskCount: existing.taskCount }, { status: 409 });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured", code: "ai_unavailable" }, { status: 503 });
  // Dictation defaults to one task per session — a spoken stream that
  // touches several sub-points isn't the same as someone asking for
  // several separate tasks. Only split when the speaker explicitly asks,
  // with one of these phrases (also enforced deterministically below,
  // in case the model doesn't fully honor this — see collapseToSingleTask).
  const dictationSingleTaskRule = source === "dictate" ? `
This is live spoken dictation, not a written meeting-notes document. By default, extract exactly ONE task covering everything said, even if it touches several sub-points — combine those into one description rather than one task each. Only extract more than one task if the speaker explicitly signals they want several separate ones, using a clear phrase like "create multiple tasks", "next task", "second task", "another task", or similar — and even then, split only at the boundaries the speaker actually marked.` : "";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: [{ role: "system", content: `Extract every concrete commitment, follow-up, decision requiring work, unanswered request, and implied action from the supplied minutes.
The source may be incomplete, badly formatted, conversational, multilingual, table-like, or use headings/initials without consistent punctuation. Treat fragments under a heading as part of that section. Preserve one task per distinct action and do not merge unrelated commitments.
Extraction completeness matters: before returning, re-scan the entire source for missed actions. Never discard an action because metadata is absent. Use null or [] for unknown fields and never invent people, dates, projects, meetings, or recipients. Follow the JSON schema exactly.
Every task must be grounded in something actually said in the source — restate or closely paraphrase it, never invent a plausible-sounding generic agenda item ("Review previous action items", "Any other business", "Discuss blockers", "Project updates", and the like) that nobody in the source actually said. If the source is short, unclear, or contains no concrete commitments, follow-ups, decisions, or requests at all, return an empty tasks array — never fill it with a typical meeting-agenda checklist just to have something to return.${dictationSingleTaskRule}` }, { role: "user", content: minutes }],
      text: { format: { type: "json_schema", name: "meeting_actions", strict: true, schema } },
    }),
  });
  if (!response.ok) return Response.json({ error: "AI extraction failed", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  let parsed: { tasks?: Array<{ subject: string; description: string; owner?: string | null; collaborators?: string[]; recipients?: string[]; [key: string]: unknown }> };
  try { parsed = JSON.parse(text); } catch { return Response.json({ error: "AI returned an invalid result", code: "ai_failed" }, { status: 502 }); }

  if (parsed.tasks?.length) {
    // Backstop for dictationSingleTaskRule above: the model doesn't
    // always follow instructions perfectly, so an untriggered dictation
    // that still comes back as several tasks gets folded into one here,
    // deterministically — see collapseToSingleTask for how nothing
    // correctly extracted gets thrown away in the process.
    if (source === "dictate" && parsed.tasks.length > 1 && !detectsMultiTaskTrigger(minutes)) {
      parsed.tasks = [collapseToSingleTask(parsed.tasks)];
    }
    // Cross-checked against every registered user (pending or active —
    // same list register()/registeredPeople elsewhere treat as "known
    // people"), not just dimensionValues' free-text person list: a real
    // account is a much safer thing to silently substitute onto than an
    // arbitrary string someone once typed. selfName resolves a literal
    // "me"/"myself"/"I" (what dictating "assign this to me" actually
    // extracts as) to the person dictating — confirmed live 2026-09-03,
    // a self-assigned task landed with owner "me" instead of their name.
    const registeredNames = (await getDb().select({ name: users.name }).from(users)).map(row => row.name);
    const selfName = source === "dictate" ? actor.name : undefined;
    parsed.tasks = parsed.tasks.map(task => {
      const resolved = resolveTaskNames(task, registeredNames, selfName);
      // Dictation is almost always either a personal reminder or a direct
      // assignment to someone else — when no owner was said at all
      // ("create a task: prepare the agenda"), the person dictating is
      // who it's for, not the generic "Unassigned" a pasted-minutes
      // record (written about several people, by someone who may not be
      // any of them) defaults to instead.
      if (source === "dictate" && !resolved.owner) return { ...resolved, owner: actor.name };
      return resolved;
    });
  }

  // onConflictDoNothing: only the *first* successful extraction for a given
  // text gets recorded, so a later force:true re-paste doesn't overwrite
  // "first pasted at" with itself — see db/schema.ts's pastedMinutes.
  if (contentHash) await getDb().insert(pastedMinutes).values({ contentHash, pastedBy: actor.name, taskCount: parsed.tasks?.length || 0 }).onConflictDoNothing();

  return Response.json(parsed);
}

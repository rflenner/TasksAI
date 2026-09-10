import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dimensionValues, sessions, tasks, users } from "../../../db/schema";
import { detectsMultiTaskTrigger } from "../../lib/dictate-intent";
import { getKnownPersonNames } from "../../lib/known-people";
import { resolveTaskNames } from "../../lib/name-resolution";
import { canCreateTask, canSeeTask, canWriteTask } from "../../lib/permissions";
import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";
import { autoAdvanceStatus, describeChanges, recordActivity } from "../../lib/task-activity";
import { isTaskNewFor, loadNewFlagContext, newlyAssignedPeople, noteAssignments } from "../../lib/task-flags";
import { callTaskExtractionAI } from "../../lib/task-extraction";
import {
  applyActionSteps, briefingWorkingList, computeBriefing, computeMatches, describeBriefing,
  describeFilterPhrase, describeLastActive, describeTaskForWalk, resolveActTargets, resolveNext, speakableDate,
  type ActionStep, type ActTarget, type Filters, type StoredTask,
} from "../../lib/voice-query";

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
  required: ["mode", "filters", "navigateTarget", "target", "actions", "answer"],
  properties: {
    mode: { type: "string", enum: ["filter", "answer", "navigate", "act", "next", "walk", "briefing", "create_task", "unclear"] },
    filters: {
      type: "object",
      additionalProperties: false,
      required: ["owner", "mineOnly", "myRole", "project", "topic", "recurringMeeting", "account", "opportunity", "source", "priority", "dueWithin", "createdWithin", "closedWithin", "status", "textContains", "isNew"],
      properties: {
        owner: { type: ["string", "null"] },
        mineOnly: { type: "boolean" },
        myRole: { type: ["string", "null"], enum: ["collaborator", "recipient", null] },
        project: { type: ["string", "null"] },
        topic: { type: ["string", "null"] },
        recurringMeeting: { type: ["string", "null"] },
        account: { type: ["string", "null"] },
        opportunity: { type: ["string", "null"] },
        source: { type: ["string", "null"] },
        priority: { type: ["string", "null"], enum: ["Low", "Medium", "High", null] },
        dueWithin: { type: ["string", "null"], enum: ["week", "overdue", null] },
        createdWithin: { type: ["string", "null"], enum: ["today", null] },
        closedWithin: { type: ["string", "null"], enum: ["today", null] },
        status: { type: ["string", "null"], enum: ["Open", "In progress", "Closed", null] },
        textContains: { type: ["string", "null"], description: "A word/phrase that must appear in the subject or description — for 'tasks with X in the subject', 'find/identify tasks about X'." },
        isNew: { type: "boolean", description: "True for 'what's new', 'show me new tasks', 'anything new assigned to me' — the same flag the on-screen NEW badge uses: created or assigned in the last 72 hours and not yet opened." },
      },
    },
    // For mode="navigate" only — opening a specific screen/form rather
    // than answering or filtering ("open dictate task", "start a new
    // action item", "paste meeting minutes").
    navigateTarget: { type: ["string", "null"], enum: ["dictate", "new_task", "paste_minutes", null] },
    // For mode="act" only — which task(s) the actions below apply to.
    // Almost always both fields stay at their default (null/false),
    // meaning "whichever task is currently open" — the ONLY two cases
    // to set one are: the user names/numbers a specific task that
    // ISN'T the one open right now (taskId), or they want the change
    // applied to every task in the most recent list discussed, not
    // just one (applyToWorkingList).
    target: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "applyToWorkingList"],
      properties: {
        taskId: { type: ["number", "null"], description: "Set ONLY when the user names or numbers a task that is NOT the one currently open/in focus (e.g. 'task 175', 'task one seven five') — the exact id from the visible tasks list. Otherwise null." },
        applyToWorkingList: { type: "boolean", description: "True ONLY when the user wants this applied to EVERY task in the most recently discussed/shown list ('add this to all of these', 'tag every one of them', 'update all the ones you just listed'), not just one task." },
      },
    },
    // For mode="act" only — an ORDERED list of one or more writes
    // against the target task(s) above, so one utterance ("push this
    // to Friday, assign it to Maya, add an update saying the redlines
    // are in, and go to the next task") becomes one turn instead of
    // four. Each entry needs exactly one type plus its one matching
    // field; the strict schema requires every field present regardless,
    // so the handler only trusts the field type actually names. A
    // trailing goto_next entry (any position is accepted, but the model
    // is told to put it last) hands off to the same list-walk "next"
    // mode uses, after every other entry's write has applied.
    // delete_task is deliberately never applied straight from this
    // schema — it only ever triggers a confirmation round trip (see
    // the route below), never an immediate delete, and never on more
    // than one task at once.
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "dueDate", "status", "priority", "owner", "textValue", "personName"],
        properties: {
          type: {
            type: ["string", "null"],
            enum: ["set_due", "set_status", "set_priority", "set_owner", "set_subject", "set_description", "set_project", "set_topic", "add_collaborator", "remove_collaborator", "add_recipient", "remove_recipient", "add_update", "delete_task", "goto_next", null],
          },
          dueDate: { type: ["string", "null"], description: "YYYY-MM-DD, resolved from any relative phrase against today's date; null means clear the due date" },
          status: { type: ["string", "null"], enum: ["Open", "In progress", "Closed", null] },
          priority: { type: ["string", "null"], enum: ["Low", "Medium", "High", null] },
          owner: { type: ["string", "null"] },
          textValue: { type: ["string", "null"], description: "For set_subject/set_description/set_project/set_topic/add_update only — the new text." },
          personName: { type: ["string", "null"], description: "For add_collaborator/remove_collaborator/add_recipient/remove_recipient only — who to add or remove." },
        },
      },
    },
    answer: { type: "string" },
  },
};

// StoredTask/Filters/ActionStep now live in app/lib/voice-query.ts,
// alongside every pure decision function below — see that file for why.

// Same "how long ago" reasoning as the Users & access page's own
// lastActive() formatter — describeLastActive itself lives in the lib;
// this just keeps the presence-lookup code below readable.

function toActionSummary(t: StoredTask) {
  return { id: t.id, subject: t.subject, owner: t.owner, due: t.due, status: t.status, priority: t.priority };
}

// Same registration every manual edit already gets (see register() in
// app/api/tasks/route.ts, not importable here — a Next.js route file
// can only export HTTP-method handlers) — a project/topic/person name
// set for the first time via voice should show up as a suggestion
// everywhere else the app offers one, the same as if it had been typed
// into the drawer by hand. Added 2026-09-08 alongside set_project/
// set_topic specifically so a brand-new project/topic name spoken by
// voice doesn't silently fail to register.
async function registerDimensionsFor(t: { project: string; recurringMeeting: string; topic: string; owner: string; collaborators: string[]; recipients: string[] }) {
  const entries: Array<[string, string]> = [
    ["project", t.project] as [string, string], ["meeting", t.recurringMeeting] as [string, string],
    ["topic", t.topic] as [string, string], ["person", t.owner] as [string, string],
    ...t.collaborators.map((c): [string, string] => ["person", c]),
    ...t.recipients.map((r): [string, string] => ["person", r]),
  ].filter(([, v]) => v);
  for (const [type, value] of entries) await getDb().insert(dimensionValues).values({ type, value }).onConflictDoNothing();
}

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    transcript?: string; currentTaskId?: number | null; workingList?: number[];
    history?: Array<{ role?: string; text?: string }>;
    // A confirmed (or declined) delete never goes through the classify
    // step at all — see "act" mode below for why this needs its own
    // short, deterministic path rather than trusting the model with an
    // irreversible action.
    confirmDeleteTaskId?: number;
  };
  const { transcript, currentTaskId, workingList, history, confirmDeleteTaskId } = body;

  // Deleting is site-admin-only, identical gate to DELETE /api/tasks and
  // the Delete button in the UI — a spoken "yes" can't grant a
  // permission the person doesn't already have everywhere else.
  if (typeof confirmDeleteTaskId === "number") {
    if (actor.role !== "site_admin") return Response.json({ mode: "unclear", filters: null, spokenAnswer: "You don't have permission to delete tasks." });
    const [target] = await getDb().select().from(tasks).where(eq(tasks.id, confirmDeleteTaskId)).limit(1);
    if (!target) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "That task doesn't exist anymore." });
    await getDb().delete(tasks).where(eq(tasks.id, confirmDeleteTaskId));
    return Response.json({ mode: "deleted", deletedTaskId: confirmDeleteTaskId, spokenAnswer: `Deleted "${target.subject}".` });
  }

  if (!transcript?.trim()) return Response.json({ error: "Nothing was asked" }, { status: 400 });
  // Confirmed live 2026-09-08: "it doesn't seem to remember what was
  // chatted before" — every turn was previously classified in total
  // isolation (only currentTaskId/workingList carried over, which is
  // "which task", not "what did we just say"). A follow-up referencing
  // something from the assistant's own last answer ("add an update
  // saying I spoke to him", where "him" was only ever named in a
  // spoken reply, not a task field) had nothing to resolve it against.
  // Capped short and defensively — this is real conversational memory
  // now, but only the last couple of exchanges, kept deliberately small
  // so it doesn't undo the latency work: unlike the visible-tasks dump
  // below, this scales with how much was actually said, not how many
  // tasks exist, so the added cost per turn is a few short sentences.
  // Worth knowing: more history still means a bigger prompt every turn
  // from here on — a longer conversation really is a bit slower per
  // question than the first one was, not just perceived.
  const recentHistory = (Array.isArray(history) ? history : [])
    .slice(-6)
    .filter((turn): turn is { role: string; text: string } => Boolean(turn) && typeof turn === "object" && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.trim().length > 0)
    .map(turn => ({ role: turn.role as "user" | "assistant", content: turn.text.slice(0, 600) }));

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
  const visible = all.filter(task => canSeeTask(task, actor) && !task.mergedIntoTaskId);
  // Same per-actor NEW computation the on-screen badge uses (see
  // app/lib/task-flags.ts) — just membership here, for the isNew filter
  // ("what's new") rather than a per-task boolean payload field.
  const newFlagContext = await loadNewFlagContext(actor.name);
  const newFlagNow = Date.now();
  const isNewTaskIds = new Set(visible.filter(t => isTaskNewFor(t, newFlagNow, newFlagContext.viewedAt.get(t.id) ?? null, newFlagContext.assignedAt.get(t.id) ?? null)).map(t => t.id));

  // Resolved against the unsliced visible list (not the 200-row summary
  // below) so "this task" still works even when it's an older task that
  // fell outside the prompt cap.
  const currentTask = typeof currentTaskId === "number" ? visible.find(t => t.id === currentTaskId) ?? null : null;
  const currentTaskSummary = currentTask ? {
    id: currentTask.id, subject: currentTask.subject, description: currentTask.description, owner: currentTask.owner,
    collaborators: currentTask.collaborators, recipients: currentTask.recipients,
    due: currentTask.due, dueSpeakable: speakableDate(currentTask.due),
    status: currentTask.status, priority: currentTask.priority, project: currentTask.project, topic: currentTask.topic, recurringMeeting: currentTask.recurringMeeting,
    updateCount: currentTask.updates.length, lastUpdate: currentTask.updates.length ? currentTask.updates[currentTask.updates.length - 1].text : null,
  } : null;

  const summary = visible.slice(0, 200).map(t => ({
    id: t.id, subject: t.subject, owner: t.owner, collaborators: t.collaborators, recipients: t.recipients,
    due: t.due, dueSpeakable: speakableDate(t.due), status: t.status, priority: t.priority, project: t.project, topic: t.topic, recurringMeeting: t.recurringMeeting,
    source: t.source, accountName: t.accountName, opportunityName: t.opportunityName, created: t.created, createdSpeakable: speakableDate(t.created),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null, closedSpeakable: t.closedAt ? speakableDate(t.closedAt.toISOString()) : null,
    updateCount: t.updates.length, lastUpdate: t.updates.length ? t.updates[t.updates.length - 1].text : null,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });

  // The exact spelling each project/meeting/topic/person/account/
  // opportunity/source is actually stored under, derived only from
  // tasks this actor can see (never an unscoped full dimension list —
  // that could leak an area-admin's out-of-scope project names or a
  // collaborator's out-of-scope coworkers). Handed to the model so
  // "Architecture calls" resolves to whatever the real recurringMeeting
  // string is, and "assign it to Maya" resolves to the exact name on
  // file, rather than the model guessing at a slightly different
  // spelling that then matches (or gets written as) something new.
  const knownProjects = [...new Set(visible.map(t => t.project).filter(Boolean))];
  const knownTopics = [...new Set(visible.map(t => t.topic).filter(Boolean))];
  const knownMeetings = [...new Set(visible.map(t => t.recurringMeeting).filter(Boolean))];
  const knownPeople = [...new Set(visible.flatMap(t => [t.owner, ...t.collaborators, ...t.recipients]).filter(Boolean))];
  const knownAccounts = [...new Set(visible.map(t => t.accountName).filter((v): v is string => Boolean(v)))];
  const knownOpportunities = [...new Set(visible.map(t => t.opportunityName).filter((v): v is string => Boolean(v)))];
  const knownSources = [...new Set(visible.map(t => t.source).filter(Boolean))];

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

  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  // Confirmed live 2026-09-08: after this route's schema/prompt grew a
  // lot (account/opportunity/source, briefing, create_task, six new act
  // step types), turnaround got dramatically — not just a little —
  // slower. GPT-5 models size their own internal "thinking" budget to
  // how complex a task LOOKS, and a much bigger branching schema with
  // more near-duplicate-sounding choices to disambiguate (mineOnly vs.
  // myRole, walk vs. briefing, thirteen action types) reads as a harder
  // task than "pick one of a few slots and fill it in" actually is.
  // reasoning.effort/text.verbosity pin both down explicitly instead of
  // leaving them to whatever the model infers — this is a fast
  // classify-and-fill-a-schema step, not something that benefits from
  // deliberation. Gated to gpt-5* specifically: OPENAI_MODEL is
  // swappable via env var, and a non-reasoning model would likely
  // reject these fields outright rather than just ignoring them.
  const isGpt5 = model.startsWith("gpt-5");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      ...(isGpt5 ? { reasoning: { effort: "minimal" } } : {}),
      input: [{
        role: "system", content: `You are Task AI's voice assistant, answering a spoken question from ${actor.name} (role: ${actor.role}). Today's date is ${today} (a ${weekday}).
${recentHistory.length ? "You are also given the last couple of exchanges of this same conversation, oldest first, for CONTEXT ONLY — use them to resolve a reference to something only ever mentioned in speech (a name, a detail from a spoken answer), or to notice the user is correcting/following up on what they just said. Never treat anything from those older messages as current fact — the visible task data below is always the fresh, authoritative source for anything factual; if the two conflict (a task's status, a due date), the fresh data wins." : ""}
${currentTaskSummary ? `The task currently open/in focus is: ${JSON.stringify(currentTaskSummary)}. "this task", "this one", or "it" in the user's question refers to this task.` : "No task is currently open/in focus."}
You are given the JSON list of every task ${actor.name} can currently see in Task AI — already permission-filtered, so never claim knowledge of a task outside it. You are also given, when available, a list of people with their role and a ready-to-speak lastActive phrase (e.g. "about 3 hours ago", "never signed in") — use that phrase exactly as given, never reformat or reinterpret it. If that list is empty, you have no presence data at all and must say so rather than guessing.
Every task's due/created/closedAt is a raw YYYY-MM-DD or ISO timestamp — fine for your own reasoning (sorting, comparing, deciding what's soonest or most recent) but NEVER speak one of those raw strings directly, it reads like nonsense out loud. Each one has a matching dueSpeakable/createdSpeakable/closedSpeakable field (e.g. "Monday, September 7th") right next to it — whenever your spoken answer mentions a date, use that speakable phrase verbatim instead, never the raw field. If the speakable field is null, that date genuinely isn't set — say so, don't invent one.
Known exact project names: ${JSON.stringify(knownProjects)}. Known exact recurring meeting names: ${JSON.stringify(knownMeetings)}. Known exact topic names: ${JSON.stringify(knownTopics)}. Known exact people: ${JSON.stringify(knownPeople)}. Known exact account names: ${JSON.stringify(knownAccounts)}. Known exact opportunity names: ${JSON.stringify(knownOpportunities)}. Known exact sources: ${JSON.stringify(knownSources)}. When the user refers to any of these by a close, partial, or differently-worded phrase, use the EXACT string from these lists in the matching field — never your own paraphrase of it.
Decide exactly one of:
- "filter": the user wants the on-screen task list narrowed down — this includes any "what/which tasks are X" phrasing where X maps to a filters field, NOT a question for "answer": "identify/find/show me all tasks with X in the subject" (textContains), "what tasks am I a recipient/reporter on" or "what am I a coworker on" (myRole — these are filter requests phrased as questions, not factual lookups). Other examples: "show me tasks with Shankar", "what's due this week", "high priority tasks in the pilot project", "tasks for the Acme Corp account", "tasks from Sales AI", "what got created today", "what's new"/"show me new tasks"/"anything new assigned to me" (isNew). The distinguishing test: if the answer is "a list of tasks matching some criteria", it's "filter" (or "walk"), even when phrased as a question — "answer" below is for questions that are NOT just "list the tasks matching X". Fill in filters with whatever criteria apply; leave answer as an empty string — the caller generates the spoken confirmation itself from the real filtered count, never trust a count you say here.
- "walk": the user wants to be guided through a whole list of tasks one at a time, starting right now ("walk me through my overdue tasks", "go through my tasks for the pilot project"). Fill in filters exactly like "filter" mode. Leave actions empty and answer empty — the caller reports how many match, opens the first one, and reads it aloud itself.
- "briefing": a quick spoken rundown of their day, not a specific filter — "give me my morning briefing", "what's my day look like", "brief me". Leave every filters field null/false, actions empty, answer empty — the caller computes real counts and speaks the summary itself.
- "create_task": describing a brand-new task to create RIGHT NOW, not asking to open a form — "create a task to send the invoice by Friday", "add a task: follow up with legal, assign it to Maya". Leave every filters field null/false, actions empty, navigateTarget null, answer empty — the caller re-reads the original spoken request itself to extract the task's content.
- "answer": a factual question the task or people data can answer, about something OTHER than "list every task matching X" (that's "filter" above) — "is anyone overdue on the pilot", "what's the latest update on the CRM task", "how many tasks does Shankar have", "when was Drew last online". Put the answer in answer, grounded ONLY in the provided data — never invent a task, person, date, or detail not present in it. Leave every filters field null/false and navigateTarget null.
- "navigate": open a specific screen or form, not ask about data — "open dictate task" -> "dictate"; "start a new action item" with genuinely no content spoken to extract -> "new_task"; "paste meeting minutes" -> "paste_minutes". Put the target in navigateTarget, leave answer empty and every filters field null/false.
- "act": change one or more tasks. One utterance can chain several field changes ("push this to Friday, assign it to Maya, add an update saying the redlines are in, and go to the next task") — one actions[] entry per change, in the order requested, each with exactly one type plus its one matching field (every other field in that entry stays null). Leave every filters field null/false, navigateTarget null, answer empty.
  WHICH task(s) — fill in target: almost always leave both fields at their default (taskId:null, applyToWorkingList:false), meaning "whichever task is currently open/in focus" (see above) — that covers ordinary "push this to Friday" while a task is open. Two exceptions: (1) the user names or numbers a task that is NOT the one open right now, e.g. "change the due date on task 175", "mark the pricing sheet task done" when that's not what's open -> set target.taskId to that task's exact id from the visible list. (2) the user wants the change applied to EVERY task in the most recent list you discussed with them (a prior "filter"/"walk"/"briefing" result, or a list you just read out in an "answer") — "add this to all of these", "tag every one of them", "update all the ones you just found" -> set target.applyToWorkingList true. If neither a task is open nor a specific one was named nor a working list exists to apply to, use "unclear" instead.
  set_due(dueDate): "push to Friday"/"set the deadline to Sept 20"/"clear the due date" — deadline/close date/completion date all mean this field. Resolve any relative phrase to YYYY-MM-DD against today: "next week"=Monday of the following week, "tomorrow"=the next calendar day, a bare weekday=its next upcoming occurrence, "ASAP"=next business day. dueDate:null clears it — a valid instruction, not a missing value.
  set_status(status): "mark done"/"close this out"->Closed, "reopen"->Open, "put in progress"->In progress.
  set_priority(priority). set_owner(owner): "assign to Maya" — use the exact known-people spelling when it matches who's meant.
  set_subject(textValue): "change/rename the subject to...". set_description(textValue): "update the description to say...". set_project(textValue): "set the project to...", "tag this to the X project" — use the exact known-project spelling when it matches. set_topic(textValue): "set the topic to...", same idea for topics.
  add_collaborator/remove_collaborator(personName): coworkers — "add/take off Maya as a coworker".
  add_recipient/remove_recipient(personName): "reporter" and "recipient" are the same field.
  add_update(textValue): "add an update saying..."/"note that...".
  delete_task: no field — "delete this task". ONLY ever asks for confirmation, never deletes immediately; NEVER combine with target.applyToWorkingList (deleting is always one task at a time — if they ask to delete several at once, use "unclear" and say so in answer instead).
  goto_next: only when they also say to move on ("...then next one") — one further entry, every field null, put last, never combined with delete_task or with target.applyToWorkingList (bulk commands don't have a single "next" to advance to).
- "next": move on to another task from the list they were just looking at, with no other change requested ("next task", "what's next", "skip this one"). ALSO use "next" when your own last turn (see the conversation history above) just asked "want me to walk you through them?" (a briefing ends with exactly that question) and the user now agrees in any way ("yes", "sure", "go ahead", "walk me through them") — that opens the first task from the briefing's own list, the same mechanism "next task" already uses. Leave every filters field null/false, actions empty, navigateTarget null, answer empty.
- "unclear": none of the above fit. Leave answer as an empty string.
For owner/coworker/recipient names, prefer the exact spelling from the known people list above when you can tell which person is meant; a first name or close match is fine otherwise — the caller does its own matching. If the user refers to their own tasks ("my tasks", "what do I have"), set mineOnly true and leave owner null. If they ask about tasks where THEY are specifically a coworker or a recipient/reporter (not owner) — "what am I a recipient on", "tasks where I'm a reporter" — set myRole to "collaborator" or "recipient" respectively instead of mineOnly. "Created today"/"closed today" map to createdWithin/closedWithin "today" respectively.`,
      }, ...recentHistory, {
        role: "user", content: `Visible tasks:\n${JSON.stringify(summary)}\n\nPeople:\n${JSON.stringify(people)}\n\nSpoken question: ${transcript}`,
      }],
      text: { ...(isGpt5 ? { verbosity: "low" } : {}), format: { type: "json_schema", name: "voice_query", strict: true, schema } },
    }),
  });
  if (!response.ok) return Response.json({ error: "Could not understand that", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const outputText = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  let parsed: { mode: "filter" | "answer" | "navigate" | "act" | "next" | "walk" | "briefing" | "create_task" | "unclear"; filters: Filters; navigateTarget: "dictate" | "new_task" | "paste_minutes" | null; target: ActTarget; actions: ActionStep[]; answer: string };
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

  // mode === "briefing": three deterministic counts, never the model's
  // own guess (same "never trust a model-computed count" rule as
  // filter/walk below) — see computeBriefing/describeBriefing. Seeds a
  // workingList too, so "next task" can page through what got flagged.
  if (parsed.mode === "briefing") {
    const counts = computeBriefing(visible, actor.name, today);
    const workingListIds = briefingWorkingList(counts);
    return Response.json({
      mode: "briefing",
      counts: { dueToday: counts.dueToday.length, overdue: counts.overdue.length, dueTodayAsRecipient: counts.dueTodayAsRecipient.length },
      workingListIds,
      spokenAnswer: describeBriefing(counts),
    });
  }

  // mode === "create_task": re-runs the exact same extraction pipeline
  // Dictate Task uses (app/api/extract, app/lib/task-extraction.ts) on
  // the ORIGINAL transcript — not anything the classify step above
  // said — so the model never has to restate what was already spoken,
  // it only has to recognize the intent. Defaults to one task per
  // utterance for the same reason a live dictation does (see
  // dictate-intent.ts): a stream-of-consciousness request naturally
  // touches a few sub-points without meaning to create several tasks.
  if (parsed.mode === "create_task") {
    const extraction = await callTaskExtractionAI(transcript, {
      extraInstruction: `
This is a spoken request to create ONE new task right now, not a written meeting-notes document. Extract exactly ONE task covering everything said, even if it touches several sub-points — combine those into one description rather than one task each, unless the speaker explicitly signals they want several separate ones (a clear phrase like "create multiple tasks", "next task", "second task", "another task").`,
    });
    if (!extraction.ok) return Response.json({ error: extraction.error, code: extraction.code }, { status: extraction.status });
    let items = extraction.tasks || [];
    if (items.length > 1 && !detectsMultiTaskTrigger(transcript)) items = [items[0]];
    if (!items.length) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "I didn't catch enough to create a task from that." });

    const registeredNames = await getKnownPersonNames();
    const resolved = resolveTaskNames(items[0], registeredNames, actor.name);
    // Same "no owner said -> the person speaking" default as Dictate
    // Task — a spoken creation request is almost always either a
    // personal reminder or a direct assignment to someone else.
    const owner = resolved.owner || actor.name;
    const values = {
      subject: String(resolved.subject || resolved.description || "New task").slice(0, 140),
      description: String(resolved.description || resolved.subject || ""),
      owner,
      collaborators: Array.isArray(resolved.collaborators) ? resolved.collaborators : [],
      recipients: Array.isArray(resolved.recipients) ? resolved.recipients : [],
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(resolved.due || "")) ? String(resolved.due) : "",
      source: "Voice dictation",
      topic: String(resolved.topic || ""),
      project: String(resolved.project || ""),
      recurringMeeting: String(resolved.recurringMeeting || ""),
      status: "Open" as const,
      created: new Date().toISOString(),
      updates: [] as Array<{ text: string; at: string; by?: string }>,
      createdBy: actor.name,
      closedAt: null,
    };
    // Same permission gate POST /api/tasks itself applies — a voice
    // request doesn't get to create something the same person couldn't
    // create by clicking "New action item" (e.g. a readonly recipient,
    // or a scoped collaborator/area-admin creating outside their scope).
    if (!canCreateTask(values, actor)) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "You don't have permission to create that task." });
    // A direct insert, not a call to POST /api/tasks — Next.js route
    // files can only export HTTP-method handlers, so there's nothing
    // there to import. Same pattern the Sales AI sync already uses for
    // the same reason (see app/lib/sales-ai-sync.ts): its own minimal
    // insert plus its own dimension-registration, not a self-fetch.
    const [created] = await getDb().insert(tasks).values(values).returning();
    const dimensionEntries: Array<[string, string]> = [
      ["project", created.project] as [string, string], ["meeting", created.recurringMeeting] as [string, string],
      ["topic", created.topic] as [string, string], ["person", created.owner] as [string, string],
      ...created.collaborators.map((c): [string, string] => ["person", c]),
      ...created.recipients.map((r): [string, string] => ["person", r]),
    ].filter(([, v]) => v);
    for (const [type, value] of dimensionEntries) await getDb().insert(dimensionValues).values({ type, value }).onConflictDoNothing();
    const dimRows = await getDb().select().from(dimensionValues).orderBy(dimensionValues.value);
    const dimensionsPayload = {
      project: dimRows.filter(x => x.type === "project").map(x => x.value),
      meeting: dimRows.filter(x => x.type === "meeting").map(x => x.value),
      topic: dimRows.filter(x => x.type === "topic").map(x => x.value),
      person: dimRows.filter(x => x.type === "person").map(x => x.value),
    };
    const dueLine = created.due ? `due ${speakableDate(created.due)}` : "no due date set";
    return Response.json({
      mode: "created", task: created, dimensions: dimensionsPayload,
      spokenAnswer: `Created a task: ${created.subject}. Assigned to ${created.owner}, ${dueLine}.`,
    });
  }

  // mode === "act": one or more writes against one or more target
  // tasks. Confirmed executed immediately, no confirmation round-trip,
  // and confirmed as a CHAIN of steps in one utterance rather than one
  // field per turn — the whole point of the coffee-morning workflow is
  // triaging tasks hands-free. delete_task is the one exception: it
  // only ever asks for confirmation here (see confirmDeleteTaskId
  // above for the actual delete), and only ever for a single task.
  if (parsed.mode === "act") {
    const target: ActTarget = parsed.target || { taskId: null, applyToWorkingList: false };
    const list = Array.isArray(workingList) ? workingList : [];
    const targets = resolveActTargets(target, currentTask, list, visible);

    if (!targets.length) {
      if (target.applyToWorkingList) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "I don't have a list to apply that to — try asking a question first, like \"show me tasks with playbook in the subject.\"" });
      if (target.taskId != null) return Response.json({ mode: "unclear", filters: null, spokenAnswer: `I couldn't find task #${target.taskId}.` });
      return Response.json({ mode: "unclear", filters: null, spokenAnswer: "You don't have a task open right now — say \"next task\" or open one first." });
    }
    const writable = targets.filter(t => canWriteTask(t, actor));
    if (!writable.length) return Response.json({ mode: "unclear", filters: null, spokenAnswer: targets.length > 1 ? "You don't have permission to change those tasks." : "You don't have permission to change that task." });

    const wantsDelete = parsed.actions.some(a => a.type === "delete_task");
    if (wantsDelete) {
      if (target.applyToWorkingList || writable.length > 1) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "I can only delete one task at a time — open the one you want to delete first, then ask again." });
      if (actor.role !== "site_admin") return Response.json({ mode: "unclear", filters: null, spokenAnswer: "You don't have permission to delete tasks." });
      return Response.json({ mode: "confirm_delete", pendingDeleteTaskId: writable[0].id, spokenAnswer: `Are you sure you want to delete "${writable[0].subject}"? Say yes to confirm.` });
    }

    const steps = parsed.actions.filter(a => a.type && a.type !== "goto_next");
    const wantsNext = parsed.actions.some(a => a.type === "goto_next");

    if (!steps.length) {
      if (!wantsNext) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "I didn't catch what you'd like changed — try \"push this to next Friday\" or \"mark this done\"." });
      // A lone "go to next task" that got classified as act with no
      // real field change — functionally identical to mode "next", so
      // just answer the same way that mode would. Only meaningful for
      // the single-current-task case; bulk has no one "next" to advance to.
      if (!currentTask) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "You don't have a task open right now — say \"next task\" or open one first." });
      if (!list.length) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "I don't have a list to move through yet — try asking a question first, like \"show me my tasks this week.\"" });
      const found = resolveNext(currentTask.id, list, visible);
      if (!found) return Response.json({ mode: "next", nextTaskId: null, task: null, spokenAnswer: "That's the last one on the list." });
      return Response.json({ mode: "next", nextTaskId: found.id, task: toActionSummary(found), spokenAnswer: describeTaskForWalk(found) });
    }

    // The same steps apply to every writable target — validation only
    // ever depends on the step's own fields (a malformed date, a blank
    // name), never on which task it's being applied to, so one failing
    // means they all would; checking just the first is representative
    // and lets a bad command fail before touching anything.
    const preview = applyActionSteps(writable[0], steps, actor.name, knownPeople);
    if (preview.error) return Response.json({ mode: "unclear", filters: null, spokenAnswer: preview.error });

    const updatedTasks: StoredTask[] = [];
    let anyStatusBumped = false;
    for (const targetTask of writable) {
      const result = applyActionSteps(targetTask, steps, actor.name, knownPeople);
      // Same auto-advance rule as PATCH /api/tasks (the manual "Post
      // update" button) — see autoAdvanceStatus — so voice and a click
      // behave identically: a posted update bumps Open -> In progress
      // unless this same command already set a status explicitly.
      const finalStatus = autoAdvanceStatus(result.updated.status, result.updatesGrew, result.explicitStatus);
      if (finalStatus !== result.updated.status) anyStatusBumped = true;
      // Identical closedAt transition rule to PATCH /api/tasks: a fresh
      // timestamp only on the Open/In progress -> Closed transition,
      // kept as-is if already closed, cleared on reopen.
      const closedAt = finalStatus !== "Closed" ? null : targetTask.status === "Closed" ? targetTask.closedAt : new Date();
      const [updated] = await getDb().update(tasks).set({ ...result.updated, status: finalStatus, closedAt }).where(eq(tasks.id, targetTask.id)).returning();
      // describeChanges deliberately skips `updates` (it's the Status
      // Updates log, shown as its own section) and no-ops with an empty
      // detail list, so calling this unconditionally is safe.
      await recordActivity(updated.id, actor.name, describeChanges(targetTask, updated));
      await noteAssignments(updated.id, newlyAssignedPeople(targetTask, updated));
      await registerDimensionsFor(updated);
      updatedTasks.push(updated);
    }

    const confirmations = [...preview.confirmations];
    if (anyStatusBumped) confirmations.push("Status moved to In progress.");
    const summaryPrefix = updatedTasks.length > 1 ? `Updated ${updatedTasks.length} tasks: ` : "";

    // A trailing goto_next resolves the same way standalone "next"
    // does, from the same client-sent workingList — applied AFTER the
    // write(s) above land, so the confirmation for what just changed
    // and the read-out of what's coming up both arrive in one turn.
    // Never fires for a bulk command — see the prompt instruction and
    // the wantsDelete-style guard above; there's no single "current"
    // task to advance from in that case.
    let nextTaskId: number | null = null;
    let nextTaskPayload: ReturnType<typeof toActionSummary> | null = null;
    let trailer = "";
    if (wantsNext && currentTask && !target.applyToWorkingList) {
      const found = resolveNext(currentTask.id, list, visible);
      if (found) {
        nextTaskId = found.id;
        nextTaskPayload = toActionSummary(found);
        trailer = ` Next up: ${describeTaskForWalk(found)}`;
      } else if (list.length) {
        trailer = " That's the last one on the list.";
      }
    }

    // Every field any action variant could have touched — not just the
    // ones this particular command changed — so the client can merge
    // this straight into its task list/drawer state and stay exactly
    // in sync with the DB without a full refetch. `task` (singular) for
    // the ordinary one-task case the client already knew how to merge;
    // `tasks` (plural) added alongside it for the new bulk case.
    const toPayload = (u: StoredTask) => ({
      id: u.id, subject: u.subject, description: u.description, owner: u.owner,
      collaborators: u.collaborators, recipients: u.recipients,
      due: u.due, status: u.status, priority: u.priority, project: u.project, topic: u.topic,
      closedAt: u.closedAt ? u.closedAt.toISOString() : null, updates: u.updates,
    });
    return Response.json({
      mode: "act",
      task: updatedTasks.length === 1 ? toPayload(updatedTasks[0]) : null,
      tasks: updatedTasks.length > 1 ? updatedTasks.map(toPayload) : null,
      nextTaskId, nextTask: nextTaskPayload,
      spokenAnswer: `${summaryPrefix}${confirmations.join(" ")}${trailer}`.trim(),
    });
  }

  // mode === "next": deterministic walk through whatever ordered id
  // list the client's last filter/walk/briefing produced (workingList)
  // — see resolveNext above. Same read-out format as "walk"'s first
  // task, so a "walk me through my overdue tasks" -> "next task" ->
  // "next task" ... session reads consistently the whole way through.
  if (parsed.mode === "next") {
    const list = Array.isArray(workingList) ? workingList : [];
    if (!list.length) return Response.json({ mode: "unclear", filters: null, spokenAnswer: "I don't have a list to move through yet — try asking a question first, like \"show me my tasks this week.\"" });
    const found = resolveNext(currentTaskId ?? null, list, visible);
    if (!found) return Response.json({ mode: "next", nextTaskId: null, task: null, spokenAnswer: "That's the last one on the list." });
    return Response.json({ mode: "next", nextTaskId: found.id, task: toActionSummary(found), spokenAnswer: describeTaskForWalk(found) });
  }

  // mode === "walk": "walk me through my overdue tasks" — filter
  // deterministically (identical rules to "filter"), then immediately
  // open and read the first match aloud, ending with a prompt for what
  // to do next — versus plain "filter", which just narrows the screen
  // silently. Seeds workingListIds exactly like "filter" so "next task"
  // continues the same walk afterward.
  if (parsed.mode === "walk") {
    const f = parsed.filters;
    const weekAhead = new Date(Date.now() + 6048e5).toISOString().slice(0, 10);
    const matches = computeMatches(f, visible, actor.name, today, weekAhead, isNewTaskIds);
    const workingListIds = matches.slice(0, 500).map(t => t.id);
    if (!matches.length) {
      return Response.json({ mode: "walk", filters: f, matchCount: 0, workingListIds: [], openTaskId: null, spokenAnswer: `You have no ${describeFilterPhrase(f)}.` });
    }
    const first = matches[0];
    return Response.json({
      mode: "walk", filters: f, matchCount: matches.length, workingListIds, openTaskId: first.id,
      spokenAnswer: `You have ${matches.length} ${describeFilterPhrase(f)}. First up: ${describeTaskForWalk(first)}`,
    });
  }

  // mode === "filter": count matches ourselves against the same
  // permission-scoped list the model saw — the spoken confirmation
  // reports a real number, never one the model might have guessed at.
  const f = parsed.filters;
  const weekAhead = new Date(Date.now() + 6048e5).toISOString().slice(0, 10);
  const matches = computeMatches(f, visible, actor.name, today, weekAhead, isNewTaskIds);
  const spokenAnswer = `Showing ${matches.length} ${describeFilterPhrase(f)}.`;

  // The exact ordered id list "next task" walks through afterwards —
  // capped well past any realistic filter result so a morning-briefing
  // "show me my open tasks" always seeds a complete list to page through.
  const workingListIds = matches.slice(0, 500).map(t => t.id);

  return Response.json({ mode: "filter", filters: f, matchCount: matches.length, workingListIds, spokenAnswer });
}

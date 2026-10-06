import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { closePlanDocuments } from "../../../../db/schema";
import { addressedToSomeoneElse, calendar, checkProposal, HELP_SPOKEN, isHelpRequest, confirmQuestion, describeActions, describeTask, LIST_FILTERS, listLabel, listMatches, planContext, type Proposal, viewerId, waitingSide } from "../../../lib/close-plan-voice";
import { canAccessPlan } from "../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";
import { cleanSessionId, recordVoiceAudit } from "../../../lib/voice-audit";
import { knownRequestNames, pickRequestName, recordRequestAsk } from "../../../lib/voice-requests";

export const dynamic = "force-dynamic";

// One spoken request about a close plan (the page's voice assistant). The AI
// reads the plan and proposes what to do; this route checks every id, person,
// phase and date it points at and turns lists and task descriptions into
// spoken text itself (never a count the model came up with). Changes are NOT
// written here: the page applies them through its own functions, so the same
// access rules, saving and activity log apply as for a click.
const schema = {
  type: "object", additionalProperties: false,
  required: ["mode", "answer", "taskId", "filter", "personId", "phaseId", "actions", "newTask", "requestName", "sameAsKnownRequest"],
  properties: {
    mode: { type: "string", enum: ["answer", "open_task", "list", "next", "act", "add_task", "unsupported", "wish", "unclear"] },
    requestName: { type: ["string", "null"] },
    sameAsKnownRequest: { type: ["string", "null"] },
    answer: { type: "string" },
    taskId: { type: ["string", "null"] },
    filter: { type: ["string", "null"], enum: [...LIST_FILTERS, null] },
    personId: { type: ["string", "null"] },
    phaseId: { type: ["string", "null"] },
    actions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["type", "status", "text", "date", "personId"],
        properties: {
          type: { type: "string", enum: ["set_status", "post_update", "set_due", "set_owner", "rename", "set_description", "add_coworker", "add_requester", "delete_task"] },
          status: { type: ["string", "null"], enum: ["Open", "In progress", "Closed", null] },
          text: { type: ["string", "null"] }, date: { type: ["string", "null"] }, personId: { type: ["string", "null"] },
        },
      },
    },
    newTask: {
      type: ["object", "null"], additionalProperties: false, required: ["title", "phaseId", "parentId", "ownerId", "due", "internal"],
      properties: { title: { type: "string" }, phaseId: { type: ["string", "null"] }, parentId: { type: ["string", "null"] }, ownerId: { type: ["string", "null"] }, due: { type: ["string", "null"] }, internal: { type: "boolean" } },
    },
  },
};

const rules = (customer: string) => `You are the voice assistant of a close plan in Task AI, talking with someone from iSEEit (the seller) about their plan with ${customer}. You get the whole plan as JSON and one spoken request. Decide what they want and fill in the schema. Answers are spoken aloud: short, plain, no ids, no field names, dates only as the given *Speakable phrases.
Modes:
- "answer": a question you answer from the plan: where things stand, what's next, what they should do, who owns what, risks. Put the spoken answer in "answer": at most two short sentences, about 40 words, the most important point first; don't list everything, offer to go through the rest. Be a helpful advisor: when asked what to do next, name the one or two most important open or overdue tasks or the next milestone, and who should act. If the answer is about one task, also set taskId so it opens on screen. Never invent anything that isn't in the plan.
- "open_task": bring one task on screen and read it ("open the security review", "tell me about the POC", "the second one"). Set taskId. Ordinals like "the second one" refer to the list on screen (listIds) when there is one.
- "list": show a list of tasks ("what's overdue", "what's open for Erik", "my tasks", "show the internal tasks", "what's left in Validate"). Set filter: mine (their own open tasks), tracking (open tasks they requested), overdue, buyer, seller, internal, person (with personId: tasks involving that person), all. phaseId narrows it to one phase. Leave answer empty; the caller counts and speaks the list.
  Waiting, by side: every person has a side (iSEEit or customer, see people and ownerSide). "What is ${customer} waiting on", "what do they need from us", "what's on us" = seller (open tasks owned by iSEEit people). "What are we waiting on from ${customer}", "what do we need from them", "what's on their side" = buyer (open tasks owned by ${customer} people). These are always "list", never "answer".
- "next": the next task of the list on screen.
- "next": also for "next", "next one", "skip this one".
- "act": change one existing task. taskId is the task (null means the task open on screen, focusTaskId). actions: set_status (Open / In progress / Closed; "done", "tick off", "complete" mean Closed), post_update (only when this request itself contains the words of an update: text = exactly those words; never add an update of your own, never repeat an earlier one), set_due (date YYYY-MM-DD, worked out from today), set_owner / add_coworker / add_requester (personId), rename (text), set_description (text, only their words), delete_task ("delete it", "remove this task"; always asked to confirm, never combined with other actions). Several actions are fine.
- "add_task": create a task or subtask. newTask: title (their words), phaseId (the phase they name; the current phase when they don't), parentId (for a subtask: the task it belongs under), ownerId (personId when named, else null), due (YYYY-MM-DD or null), internal (true only when they say internal or "just for us").
- "unsupported": they want something this assistant can't do: inviting someone or sharing the plan ("invite Olivia", "send her the link"), sending emails or messages, deleting a phase or the plan, changing access rights, exporting, scheduling a meeting, the task history, anything outside this plan. answer: one short sentence "I can't do that yet" plus, only if it really helps, the closest thing from what you CAN do (the modes above: answer, list, open, change status/dates/owner/coworkers/requested by of a task, post an update, add a task or subtask). Never suggest anything else. requestName: your own NEW short name for the feature they want in THIS request, 2 to 6 words, Title Case (e.g. "Task History By Voice"); never copy a known request name into requestName. sameAsKnownRequest: one of the known request names ONLY if it is clearly the very same feature, else null.
- "wish": they tell you what they'd like you or the app to do ("I wish you could…", "it would be great if…", "feature request: …", "can you learn to…"). requestName as above. answer: a short thank-you saying it's noted.
- "unclear": you can't tell what they want, or they're talking to someone else. Put a short question or "Okay." in answer.
requestName and sameAsKnownRequest are null in every other mode. Never mention a request name in any answer.
Use the exact ids from the plan JSON. People are matched by name; "me"/"I" is "you" in the JSON. Dates: use the calendar you're given to turn "Friday", "next Tuesday" or "in two weeks" into YYYY-MM-DD; a bare weekday means the next one after today.`;

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured" }, { status: 503 });
  const body = await request.json().catch(() => null) as { planId?: unknown; utterance?: unknown; action?: unknown; focusTaskId?: unknown; listIds?: unknown; history?: unknown; sessionId?: unknown } | null;
  const planId = typeof body?.planId === "string" ? body.planId : "";
  const utterance = typeof body?.utterance === "string" ? body.utterance.trim().slice(0, 1000) : "";
  if (!utterance) return Response.json({ error: "Nothing was said" }, { status: 400 });
  const [row] = planId ? await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, planId)).limit(1) : [];
  if (!row || row.deletedAt || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });

  const data = row.data;
  const today = new Date().toISOString().slice(0, 10);
  const viewer = viewerId(data, actor.email);
  const focusTaskId = typeof body?.focusTaskId === "string" ? body.focusTaskId : null;
  const listIds = Array.isArray(body?.listIds) ? (body!.listIds as unknown[]).filter(x => typeof x === "string").slice(0, 200) as string[] : [];
  const history = Array.isArray(body?.history) ? (body!.history as Array<{ role?: unknown; text?: unknown }>).slice(-6)
    .map(h => ({ role: h.role === "assistant" ? "assistant" as const : "user" as const, content: String(h.text || "").slice(0, 600) })).filter(h => h.content) : [];
  const customer = typeof data.account === "string" && data.account ? data.account : "the customer";

  // Meant for someone in the room, not for the assistant.
  if (addressedToSomeoneElse(utterance, Array.isArray(data.people) ? data.people as Array<{ name?: unknown }> : [])) return Response.json({ mode: "unclear", spokenAnswer: "Okay." });

  // "What can you do?" is answered from the capability list, not by the AI.
  if (isHelpRequest(utterance)) return Response.json({ mode: "help", spokenAnswer: HELP_SPOKEN(customer) });

  // "Next" needs no AI: the next task of the list on screen.
  if (body?.action === "next") return Response.json(shape(data, { mode: "next", answer: "", taskId: null, filter: null, personId: null, phaseId: null, actions: [], newTask: null }, focusTaskId, listIds, viewer, today, utterance));

  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const isGpt5 = model.startsWith("gpt-5");
  const requestNames = await knownRequestNames().catch(() => [] as string[]);
  let proposal: Proposal & { requestName?: string | null; sameAsKnownRequest?: string | null };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, ...(isGpt5 ? { reasoning: { effort: "minimal" } } : {}),
        input: [
          { role: "system", content: rules(customer) },
          ...history,
          { role: "user", content: `Plan:\n${JSON.stringify(planContext(data, viewer, today))}\n\nCalendar: ${calendar(today)}\nfocusTaskId (open on screen): ${focusTaskId || "none"}\nlistIds (list on screen, in order): ${JSON.stringify(listIds)}\nKnown request names: ${JSON.stringify(requestNames)}\n\nSpoken request: ${utterance}` },
        ],
        text: { ...(isGpt5 ? { verbosity: "low" } : {}), format: { type: "json_schema", name: "close_plan_voice", strict: true, schema } },
      }),
    });
    if (!response.ok) return Response.json({ error: "Sorry, I couldn't work that out." }, { status: 502 });
    const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    proposal = JSON.parse(result.output_text || result.output?.flatMap(i => i.content || []).map(c => c.text || "").join("") || "{}");
  } catch {
    return Response.json({ error: "Sorry, I couldn't work that out." }, { status: 502 });
  }

  const side = waitingSide(utterance, [customer, ...(Array.isArray(data.people) ? (data.people as Array<{ side?: unknown; name?: unknown }>).filter(p => p.side === "buyer").map(p => String(p.name || "")) : [])]);
  if (side && (proposal.mode === "list" || proposal.mode === "answer")) proposal = { ...proposal, mode: "list", filter: side, personId: null };
  const reply = shape(data, proposal, focusTaskId, listIds, viewer, today, utterance);
  // Something it can't do yet, or a wish: filed as a product request.
  if ((proposal.mode === "unsupported" || proposal.mode === "wish") && proposal.requestName) {
    const name = pickRequestName(proposal.requestName, proposal.sameAsKnownRequest ?? null, requestNames, utterance);
    proposal = { ...proposal, requestName: name };
    try { await recordRequestAsk({ id: actor.id, name: actor.name }, { sessionId: cleanSessionId(body?.sessionId), surface: "close_plan", requestName: name, kind: proposal.mode === "wish" ? "wish" : "unsupported", utterance }); }
    catch (error) { console.error("Voice request could not be recorded:", error instanceof Error ? error.message : error); }
  }
  try {
    await recordVoiceAudit({ id: actor.id, name: actor.name }, [{
      sessionId: cleanSessionId(body?.sessionId), source: "live", event: "request", utterance, mode: `close_plan:${reply.mode}`,
      outcome: reply.mode === "act" || reply.mode === "add_task" ? "changed" : reply.mode === "confirm" ? "awaiting_confirmation" : reply.mode === "unclear" || reply.mode === "unsupported" ? "not_done" : "shown",
      taskIds: [], spokenAnswer: reply.spokenAnswer, detail: { surface: "close_plan", planId, taskId: reply.taskId ?? null, requestName: proposal.requestName ?? null, proposal },
    }]);
  } catch (error) { console.error("Close plan voice audit failed:", error instanceof Error ? error.message : error); }
  return Response.json(reply);
}

type Reply = { mode: string; spokenAnswer: string; taskId?: string | null; filter?: string | null; personId?: string | null; phaseId?: string | null; listIds?: string[]; actions?: unknown[]; newTask?: unknown };

function shape(data: Record<string, unknown>, p: Proposal, focusTaskId: string | null, listIds: string[], viewer: string | null, today: string, utterance: string): Reply {
  const tasks = Array.isArray(data.tasks) ? data.tasks as Array<{ id: string }> : [];
  const known = (id: string | null) => Boolean(id) && tasks.some(t => t.id === id);
  switch (p.mode) {
    case "answer": return { mode: "answer", spokenAnswer: p.answer || "I'm not sure.", taskId: known(p.taskId) ? p.taskId : null };
    case "open_task":
      if (!known(p.taskId)) return { mode: "unclear", spokenAnswer: "I couldn't tell which task you mean. Say part of its name." };
      return { mode: "open_task", taskId: p.taskId, spokenAnswer: `${listIds.includes(p.taskId!) ? `Number ${listIds.indexOf(p.taskId!) + 1} of ${listIds.length}. ` : ""}${describeTask(data, p.taskId!, today)}` };
    case "list": {
      const filter = p.filter || "all";
      const ids = listMatches(data, filter, viewer, today, p.personId, p.phaseId);
      const label = listLabel(data, filter, p.personId, p.phaseId);
      const first = ids[0] ? describeTask(data, ids[0], today) : "";
      return { mode: "list", filter, personId: p.personId, phaseId: p.phaseId, listIds: ids, taskId: ids[0] || null,
        spokenAnswer: ids.length ? `${ids.length} ${label}. First: ${first}` : `There are no ${label}.` };
    }
    case "next": {
      const at = focusTaskId ? listIds.indexOf(focusTaskId) : -1;
      const next = listIds[at + 1];
      return next ? { mode: "open_task", taskId: next, spokenAnswer: `Number ${at + 2} of ${listIds.length}. ${describeTask(data, next, today)}` }
        : { mode: "unclear", spokenAnswer: listIds.length ? "That was the last one on the list." : "There's no list to go through yet. Ask for one, like what's overdue." };
    }
    case "act": case "add_task": {
      const checked = checkProposal(data, p, focusTaskId, utterance);
      if (!checked.ok) return { mode: "unclear", spokenAnswer: checked.reason };
      if (checked.newTask) return { mode: "add_task", newTask: checked.newTask, spokenAnswer: "" };
      const question = confirmQuestion(data, checked.taskId!, checked.actions, today);
      return { mode: question ? "confirm" : "act", taskId: checked.taskId, actions: checked.actions, spokenAnswer: question || describeActions(data, checked.taskId!, checked.actions, today) };
    }
    case "unsupported": return { mode: "unsupported", spokenAnswer: `${(p.answer || "I can't do that yet").trim().replace(/([^.!?])$/, "$1.")} I've noted it as a request.` };
    case "wish": return { mode: "wish", spokenAnswer: p.answer || "Thanks, I've noted that." };
    default: return { mode: "unclear", spokenAnswer: p.answer || "Sorry, I didn't get that." };
  }
}

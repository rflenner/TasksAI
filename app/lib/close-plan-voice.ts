// Close Plan voice assistant: the plan as the assistant sees it, the lists it
// can show, and the checks on what the AI proposes. Pure and DB-free so the
// rules are unit-tested (tests/close-plan-voice.test.ts); the route in
// app/api/close-plans/voice does the AI call, and the page applies the
// changes itself, through the same functions (and access rules) as a click.
//
// Built for the iSEEit team first. `audience` is already part of the shape so
// a customer contact's view (internal tasks removed, see customerView in
// close-plan-share.ts) can use the same assistant later.

import { isHelpRequest, type Capability } from "./voice-help";
import { calendar, grounded, mentionsDate, namedIn } from "./voice-grounding";
export type { Capability } from "./voice-help";
export { calendar, grounded, namedIn };

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : [];
const str = (v: unknown, max = 300) => typeof v === "string" ? v.slice(0, max) : "";

// The page's own task filters (prototype/close-plan-demo.html, matches()).
export const LIST_FILTERS = ["all", "mine", "tracking", "overdue", "buyer", "seller", "internal", "person"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];
export const STATUSES = ["Open", "In progress", "Closed"] as const;
export const ACTION_TYPES = ["set_status", "post_update", "set_due", "set_owner", "rename", "set_description", "add_coworker", "add_requester", "remove_coworker", "remove_requester", "set_phase", "set_shared", "set_milestone", "delete_task", "shift_due"] as const;

// One action on one task. Every control of the task details has one: the status
// dropdown (set_status, also the subtask checkboxes), the phase dropdown
// (set_phase), due date, owner, coworkers, requested by, title, description, the
// "Shared with customer" and "Milestone" switches, plus status updates.
export type VoiceAction = { type: (typeof ACTION_TYPES)[number]; status: string | null; text: string | null; date: string | null; personId: string | null; phaseId?: string | null; flag?: boolean | null; days?: number | null };
// What the AI reads out of one spoken request about a new task. `done` = the person
// declined to give more ("skip", "that's all").
export type NewTask = { title: string; phaseId: string | null; parentId: string | null; ownerId: string | null; due: string | null; description?: string | null; internal: boolean; done?: boolean };
// A task being created over several turns: what is known so far, and what has
// already been asked (so nobody is asked twice). Held by the page between turns.
export type Draft = { title: string; phaseId: string | null; parentId: string | null; ownerId: string | null; due: string | null; description: string | null; internal: boolean; askedPhase: boolean; askedDetails: boolean };
export type Proposal = {
  mode: "answer" | "open_task" | "list" | "next" | "act" | "act_many" | "shift_plan" | "view_phase" | "act_phase" | "briefing" | "news" | "add_task" | "unsupported" | "wish" | "unclear";
  answer: string; taskId: string | null; filter: ListFilter | null; personId: string | null; phaseId: string | null;
  actions: VoiceAction[]; newTask: NewTask | null; requestName?: string | null; phaseEdit?: PhaseEditProposal | null;
  shiftDays?: number | null; shiftTasks?: boolean | null; groups?: Array<{ taskIds: string[]; actions: VoiceAction[] }> | null; viewOpen?: boolean | null;
};

// A change to a phase of the plan, spoken: rename it, move its start or end date, change its description, add a
// new phase, or delete one. Only the fields the person mentioned are set; the rest stay null.
export type PhaseEditProposal = { sort?: boolean | null; add: boolean; remove: boolean; name: string | null; goal: string | null; start: string | null; end: string | null; moveTo: string | null };
// What the page applies (same shape, checked): `phaseId` null only for a new phase.
export type PhaseEdit = { sort?: boolean; phaseId: string | null; add: boolean; remove: boolean; name: string | null; goal: string | null; start: string | null; end: string | null; moveTo: string | null; moved: number };

// Checks a spoken phase change against the plan. Names and descriptions must be the person's own words,
// dates must be real and in order (a phase can't end before it starts), and a phase is only deleted after a
// yes: its tasks move to a neighbouring phase (or the one named), they are never deleted.
export function checkPhaseEdit(data: Obj, phaseId: string | null, e: PhaseEditProposal | null | undefined, utterance: string, today: string):
  { ok: true; edit: PhaseEdit; said: string; question: string | null } | { ok: false; reason: string } {
  if (!e) return { ok: false, reason: "I understood it was about a phase, but not what to change." };
  const phases = arr(data.phases), tasks = arr(data.tasks);
  if (e.sort) {
    const sorted = [...phases].sort((a, b) => str(a.start).localeCompare(str(b.start)) || str(a.end).localeCompare(str(b.end)));
    const same = sorted.every((p, i) => p.id === phases[i].id);
    if (same) return { ok: false, reason: "The phases are already in date order." };
    return { ok: true, question: null, said: `Put the phases in date order: ${sorted.map(p => str(p.name)).join(", ")}.`, edit: { sort: true, phaseId: null, add: false, remove: false, name: null, goal: null, start: null, end: null, moveTo: null, moved: 0 } };
  }
  const cleanDate = (v: string | null) => v && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) ? v : null;
  const name = e.name && e.name.trim() && grounded(e.name, utterance) ? e.name.trim().slice(0, 120) : null;
  const goal = e.goal && e.goal.trim() && grounded(e.goal, utterance) ? e.goal.trim().slice(0, 300) : null;
  const start = cleanDate(e.start), end = cleanDate(e.end);
  const spokenDate = (d: string) => speakable(d, today);
  if (e.add) {
    if (!name) return { ok: false, reason: "What should the new phase be called?" };
    if (phases.some(p => str(p.name).toLowerCase() === name.toLowerCase())) return { ok: false, reason: `There is already a phase called ${name}.` };
    if (!start || !end) return { ok: false, reason: `When does ${name} start and end?` };
    if (end < start) return { ok: false, reason: "A phase can't end before it starts." };
    return { ok: true, question: null, said: `Added the phase "${name}", ${spokenDate(start)} to ${spokenDate(end)}.`, edit: { phaseId: null, add: true, remove: false, name, goal, start, end, moveTo: null, moved: 0 } };
  }
  const phase = phaseId ? phases.find(p => p.id === phaseId) : null;
  if (!phase) return { ok: false, reason: "I couldn't tell which phase you mean. Say its name." };
  const pname = str(phase.name);
  if (e.remove) {
    // Deleting is only ever done on the word "delete" or "remove": "collapse" and "fold" are about the screen.
    if (!/\b(delete|remove|get rid of|drop)\b/i.test(utterance)) return { ok: false, reason: "Do you want to delete the phase, or only fold it away on screen? Say delete, or collapse." };
    if (phases.length < 2) return { ok: false, reason: "A plan needs at least one phase." };
    const count = tasks.filter(t => t.phase === phase.id).length;
    const index = phases.findIndex(p => p.id === phase.id);
    const target = (e.moveTo && e.moveTo !== phase.id ? phases.find(p => p.id === e.moveTo) : null) ?? phases[index - 1] ?? phases[index + 1];
    const moveTo = count ? String(target.id) : null;
    return {
      ok: true, said: `Deleted the phase "${pname}"${count ? ` and moved its ${count} task${count > 1 ? "s" : ""} to ${str(target.name)}` : ""}.`,
      question: `Delete the phase "${pname}"${count ? `? Its ${count} task${count > 1 ? "s" : ""} move to ${str(target.name)}` : ""}. This can't be undone. Say yes to confirm.`.replace("?.", "."),
      edit: { phaseId: String(phase.id), add: false, remove: true, name: null, goal: null, start: null, end: null, moveTo, moved: count },
    };
  }
  const newStart = start ?? str(phase.start), newEnd = end ?? str(phase.end);
  if ((start || end) && newEnd < newStart) return { ok: false, reason: `${pname} can't end before it starts. It runs from ${spokenDate(newStart)} to ${spokenDate(newEnd)}.` };
  const parts: string[] = [];
  if (name && name !== pname) parts.push(`Renamed "${pname}" to "${name}".`);
  if (start && start !== str(phase.start)) parts.push(`${name ?? pname} now starts ${spokenDate(start)}.`);
  if (end && end !== str(phase.end)) parts.push(`${name ?? pname} now ends ${spokenDate(end)}.`);
  if (goal) parts.push(`Updated the description of ${name ?? pname}.`);
  if (!parts.length) return { ok: false, reason: `Nothing to change on ${pname}.` };
  return { ok: true, question: null, said: parts.join(" "), edit: { phaseId: String(phase.id), add: false, remove: false, name, goal, start, end, moveTo: null, moved: 0 } };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- Changing many tasks at once, and moving the whole plan. Both are always confirmed first, with the count. ----

// The task changes that make sense for several tasks at once. Text edits, updates and deletes stay one task at a time.
const BULK_ACTIONS = ["set_status", "set_due", "shift_due", "set_owner", "set_phase", "set_shared", "set_milestone", "add_coworker", "remove_coworker", "add_requester", "remove_requester"];
// One group = the same actions on several tasks. A request can hold several groups: "move A and B back a week, close C".
export type BulkGroup = { taskIds: string[]; actions: VoiceAction[] };
export type BulkChange = { groups: BulkGroup[] };
export function checkBulk(data: Obj, p: Proposal, listIds: string[], utterance: string):
  { ok: true; change: BulkChange; question: string; said: string } | { ok: false; reason: string } {
  const tasks = arr(data.tasks), phases = arr(data.phases), people = arr(data.people);
  const raw = p.groups && p.groups.length ? p.groups.map(g => ({ ...g, phaseId: null as string | null })) : [{ taskIds: [] as string[], actions: p.actions || [], phaseId: p.phaseId }];
  const groups: BulkGroup[] = [], verbs: string[] = [];
  for (const g of raw.slice(0, 6)) {
    const named = g.taskIds.length > 0, phase = !named && g.phaseId ? phases.find(x => x.id === g.phaseId) : null;
    let targets = named ? tasks.filter(t => g.taskIds.includes(String(t.id))) : phase ? tasks.filter(t => t.phase === phase.id && !t.parent) : tasks.filter(t => listIds.includes(String(t.id)));
    if (!targets.length) return { ok: false, reason: named ? "I couldn't find those tasks. Say their names." : "There is no list on screen to change. Ask for one first, like the tasks in a phase, or name the tasks." };
    if (g.actions.some(a => !BULK_ACTIONS.includes(a.type))) return { ok: false, reason: "I can change status, dates, owners, sharing and phase on many tasks at once. Posting updates, renaming and deleting go one task at a time." };
    if (g.actions.some(a => a.type === "set_phase")) targets = targets.filter(t => !t.parent);
    // Each task is checked on its own (a subtask can't change phase, a task without a due date can't be moved by days).
    let failure = "", actions: VoiceAction[] = [];
    const ok = targets.slice(0, 100).filter(t => {
      const c = checkProposal(data, { ...p, taskId: String(t.id), actions: g.actions }, null, utterance);
      if (c.ok) { if (!actions.length) actions = c.actions; return true; }
      failure = c.reason; return false;
    });
    if (!ok.length) return { ok: false, reason: failure || "I couldn't apply that to those tasks." };
    groups.push({ taskIds: ok.map(t => String(t.id)), actions });
    const n = ok.length, where = phase ? ` in ${str(phase.name)}` : "";
    const subject = named && n <= 4 ? ok.map(t => `"${str(t.title)}"`).join(", ").replace(/, ([^,]*)$/, " and $1") : plural(n, "task") + where;
    const a = actions[0], who = str(people.find(x => x.id === a.personId)?.name);
    verbs.push(actions.length > 1 ? `Change ${subject}`
      : a.type === "set_shared" ? `Make ${subject} ${a.flag ? "shared with the customer" : "internal"}`
      : a.type === "set_status" ? `Set ${subject} to ${a.status}`
      : a.type === "set_due" ? `Move ${subject} to ${speakable(a.date, "")}`
      : a.type === "shift_due" ? `Move ${subject} ${shiftWords(a.days)}`
      : a.type === "set_owner" ? `Make ${who} the owner of ${subject}`
      : a.type === "set_phase" ? `Move ${subject} to ${str(phases.find(x => x.id === a.phaseId)?.name)}`
      : a.type === "set_milestone" ? `${a.flag ? "Mark" : "Unmark"} ${subject} as ${a.flag ? "milestones" : "not milestones"}`
      : `Change ${subject}`);
  }
  const text = verbs.map((v, i) => i ? v[0].toLowerCase() + v.slice(1) : v).join(" and ");
  return { ok: true, change: { groups }, question: `${text}? Say yes to confirm.`, said: `${text}.` };
}

// Moving the whole plan by some days (negative = earlier): every phase, and with `tasks` also the due date of every open task.
export type ShiftChange = { days: number; tasks: boolean; phases: number; taskCount: number };
export function checkShift(data: Obj, days: unknown, tasks: unknown, utterance: string):
  { ok: true; change: ShiftChange; question: string } | { ok: false; reason: string } {
  const d = typeof days === "number" && Number.isInteger(days) ? days : 0;
  if (!d) return { ok: false, reason: "By how many days or weeks should I move the plan, and later or earlier?" };
  if (Math.abs(d) > 365) return { ok: false, reason: "That is more than a year. Say a smaller shift." };
  const phases = arr(data.phases).length;
  const withTasks = tasks === true || /\b(whole|entire) plan\b|\beverything\b|\band the tasks\b|\ball (the )?(dates|tasks)\b/i.test(utterance);
  const taskCount = withTasks ? arr(data.tasks).filter(t => t.status !== "Closed" && DATE.test(str(t.due))).length : 0;
  if (!phases) return { ok: false, reason: "The plan has no phases to move." };
  const abs = Math.abs(d), span = abs % 7 === 0 ? plural(abs / 7, "week") : plural(abs, "day"), dir = d > 0 ? "later" : "earlier";
  return {
    ok: true, change: { days: d, tasks: withTasks, phases, taskCount },
    question: `Move all ${plural(phases, "phase")}${withTasks ? ` and the due dates of ${plural(taskCount, "open task")}` : ""} ${span} ${dir}?${withTasks ? " Closed tasks stay as they are." : " Task due dates stay as they are."} Say yes to confirm.`,
  };
}

// "1 week later", "3 days earlier": a number of days spoken the way a person says it.
export const shiftWords = (days: number | null | undefined) => {
  const d = days || 0, abs = Math.abs(d);
  return `${abs % 7 === 0 ? plural(abs / 7, "week") : plural(abs, "day")} ${d > 0 ? "later" : "earlier"}`;
};
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// "Give me a briefing": the plan in a few spoken sentences. Every number is counted here, never by the AI.
// Overdue, due soon and who owes what are about open tasks (subtasks included); progress counts main tasks.
export function briefing(data: Obj, customer: string, today: string): string {
  const phases = arr(data.phases), tasks = arr(data.tasks), people = arr(data.people);
  const sideOf = (id: unknown) => people.find(p => p.id === id)?.side;
  const open = tasks.filter(t => t.status !== "Closed");
  const main = tasks.filter(t => !t.parent), mainClosed = main.filter(t => t.status === "Closed").length;
  const current = phases.filter(p => str(p.start) <= today && today <= str(p.end));
  const parts: string[] = [];
  if (current.length) parts.push(`You are in ${current.map(p => `${str(p.name)}, which ends ${speakable(p.end, today)}`).join(" and ")}.`);
  else { const next = phases.find(p => str(p.start) > today); parts.push(next ? `The plan starts with ${str(next.name)} on ${speakable(next.start, today)}.` : "All phases are in the past."); }
  parts.push(`${mainClosed} of ${plural(main.length, "main task")} ${mainClosed === 1 ? "is" : "are"} closed.`);
  const overdue = open.filter(t => str(t.due) && str(t.due) < today).sort((a, b) => str(a.due).localeCompare(str(b.due)));
  parts.push(overdue.length ? `${plural(overdue.length, "task")} ${overdue.length === 1 ? "is" : "are"} overdue${overdue.length <= 2 ? `: ${overdue.map(t => `"${str(t.title)}"`).join(" and ")}` : `, the oldest is "${str(overdue[0].title)}"`}.` : "Nothing is overdue.");
  const soon = open.filter(t => str(t.due) >= today && str(t.due) <= addDays(today, 7));
  if (soon.length) parts.push(`${plural(soon.length, "task")} ${soon.length === 1 ? "is" : "are"} due in the next 7 days.`);
  const onUs = open.filter(t => sideOf(t.owner) === "seller").length, onThem = open.filter(t => sideOf(t.owner) === "buyer").length;
  parts.push(`We have ${plural(onUs, "open task")}; ${customer} has ${onThem}.`);
  const milestone = tasks.filter(t => t.milestone && t.status !== "Closed" && str(t.due) >= today).sort((a, b) => str(a.due).localeCompare(str(b.due)))[0];
  if (milestone) parts.push(`The next milestone is "${str(milestone.title)}" on ${speakable(milestone.due, today)}.`);
  if (overdue.length) parts.push("Say 'what's overdue' to go through them.");
  return parts.join(" ");
}

// How far back "what's new" looks: said in the request ("today", "yesterday", "this week", "this month"), else a week.
export function newsDays(utterance: string): number {
  if (/\btoday\b/i.test(utterance)) return 1;
  if (/\byesterday\b/i.test(utterance)) return 2;
  if (/\b(month)\b/i.test(utterance)) return 30;
  return 7;
}

// "What's new": what the plan's activity feed recorded in the last few days, newest first, counted by person.
// The feed keeps only the latest 40 changes, so the answer says when that limit is what it is reading.
// `who` narrows it to what the customer's people (or one person) did: "any client activity?".
export function whatsNew(data: Obj, today: string, days: number, who: { side?: "seller" | "buyer" | null; personId?: string | null } = {}, customer = "the customer"): string {
  const people = arr(data.people), name = (id: unknown) => str(people.find(p => p.id === id)?.name).split(" ")[0] || "Someone";
  const since = addDays(today, -(days - 1));
  const feed = arr(data.activity);
  const mine = (a: Obj) => who.personId ? a.by === who.personId : who.side ? people.find(p => p.id === a.by)?.side === who.side : true;
  const items = feed.filter(a => DATE.test(str(a.at).slice(0, 10)) && str(a.at).slice(0, 10) >= since && str(a.text) && mine(a));
  const period = days === 1 ? "today" : days === 2 ? "since yesterday" : `in the last ${days} days`;
  const subject = who.personId ? `by ${name(who.personId)}` : who.side === "buyer" ? `by ${customer} people` : who.side === "seller" ? "by the iSEEit team" : "";
  if (!items.length) return `Nothing has changed ${subject ? `${subject} ` : ""}${period}.`;
  const counts = new Map<string, number>();
  for (const a of items) counts.set(name(a.by), (counts.get(name(a.by)) || 0) + 1);
  const byPerson = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, c]) => `${n} ${c}`).join(", ");
  const lines = items.slice(0, 3).map(a => `${name(a.by)} ${str(a.text, 160).replace(/\s+by voice$/, "")}`);
  const capped = feed.length >= 40 && !who.personId && !who.side;
  const head = `${capped && items.length >= 40 ? "The latest 40 changes" : plural(items.length, "change")}${subject ? ` ${subject}` : ""} ${period}.`;
  return `${head}${counts.size > 1 ? ` By person: ${byPerson}.` : ""} Newest: ${lines.join(". ")}.`;
}

// "What's up next": the open tasks that are due soonest, overdue ones first, as a list to walk through.
export function upcomingIds(data: Obj, limit = 10): string[] {
  return arr(data.tasks).filter(t => t.status !== "Closed" && DATE.test(str(t.due)))
    .sort((a, b) => str(a.due).localeCompare(str(b.due))).slice(0, limit).map(t => String(t.id));
}

// Folding phases away (or opening them) on screen. Changes nothing in the plan.
export function checkView(data: Obj, phaseId: string | null, open: boolean | null): { ok: true; phaseIds: string[]; open: boolean; said: string } | { ok: false; reason: string } {
  const phases = arr(data.phases);
  const phase = phaseId ? phases.find(p => p.id === phaseId) : null;
  if (phaseId && !phase) return { ok: false, reason: "I couldn't tell which phase you mean. Say its name." };
  const opening = open === true;
  return { ok: true, open: opening, phaseIds: phase ? [String(phase.id)] : phases.map(p => String(p.id)), said: `${opening ? "Opened" : "Collapsed"} ${phase ? str(phase.name) : "all phases"}.` };
}

export function speakable(date: unknown, today: string): string {
  if (typeof date !== "string" || !DATE.test(date)) return "";
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate(), suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const year = date.slice(0, 4) !== today.slice(0, 4) ? `, ${date.slice(0, 4)}` : "";
  return `${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, ${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${day}${suffix}${year}`;
}

// "What is Meridian waiting on" vs "what are we waiting on from Meridian":
// decided from who comes before "waiting", not left to the AI (a live test got
// it backwards twice). seller = open tasks owned by iSEEit (the customer waits
// on us), buyer = open tasks owned by the customer (we wait on them).
export function waitingSide(utterance: string, customerNames: string[]): "seller" | "buyer" | null {
  const m = /^(.*?)\b(waiting|wait)\b(.*)$/i.exec(utterance);
  if (!m) return null;
  const before = ` ${m[1].toLowerCase()} `, after = ` ${m[3].toLowerCase()} `;
  // Full names and their first word ("Cluepoints" for "Cluepoints SA", "Olivia" for "Olivia Grant").
  const names = [...new Set(customerNames.flatMap(n => [n.trim().toLowerCase(), n.trim().toLowerCase().split(/\s+/)[0]]).filter(n => n.length >= 3))];
  const isCustomer = (s: string) => /\b(they|them|their|customer|client)\b/.test(s) || names.some(n => s.includes(n));
  const isUs = (s: string) => /\b(we|us|our|iseeit)\b/.test(s);
  if (isUs(before) && !isCustomer(before)) return "buyer";
  if (isCustomer(before) && !isUs(before)) return "seller";
  if (isCustomer(after) && !isUs(after)) return "buyer";
  if (isUs(after) && !isCustomer(after)) return "seller";
  return null;
}

// "Drew, can you check that?" is meant for Drew, not for the assistant.
export function addressedToSomeoneElse(utterance: string, people: Array<{ name?: unknown }>): boolean {
  const m = /^\s*(?:hey\s+|ok(?:ay)?\s+)?([\p{L}'-]+)\s*,/iu.exec(utterance);
  if (!m) return false;
  const first = m[1].toLowerCase();
  return people.some(p => String(p.name || "").trim().split(/\s+/)[0].toLowerCase() === first);
}

export function viewerId(data: Obj, email: string): string | null {
  const e = email.trim().toLowerCase();
  const p = arr(data.people).find(x => x.side === "seller" && str(x.email).trim().toLowerCase() === e);
  return p ? String(p.id) : null;
}

const isShared = (t: Obj, tasks: Obj[]) => t.shared !== false && (!t.parent || tasks.find(p => p.id === t.parent)?.shared !== false);

// The plan as compact JSON for the AI: names instead of ids where it helps it
// talk, ids where it has to point at something.
export function planContext(data: Obj, viewer: string | null, today: string, audience: "seller" | "buyer" = "seller") {
  const people = arr(data.people);
  const name = (id: unknown) => str(people.find(p => p.id === id)?.name) || "Unassigned";
  const side = (id: unknown) => people.find(p => p.id === id)?.side === "buyer" ? "customer" : "iSEEit";
  const all = arr(data.tasks);
  const tasks = audience === "buyer" ? all.filter(t => isShared(t, all)) : all;
  return {
    title: str(data.title), customer: str(data.account), today, todaySpeakable: speakable(today, today),
    you: viewer ? { id: viewer, name: name(viewer) } : null,
    planOwners: { iSEEit: name((data.planOwners as Obj | undefined)?.seller), customer: name((data.planOwners as Obj | undefined)?.buyer) },
    phases: arr(data.phases).map(p => ({ id: p.id, name: p.name, goal: str(p.goal, 200), start: p.start, end: p.end, current: str(p.start) <= today && today <= str(p.end) })),
    people: people.map(p => ({ id: p.id, name: p.name, side: p.side === "buyer" ? "customer" : "iSEEit", title: str(p.title, 80), role: str(p.role, 80) })),
    tasks: tasks.map(t => {
      const ups = arr(t.updates);
      return {
        id: t.id, phase: t.phase, parent: t.parent || null, title: str(t.title, 200), details: str(t.desc, 300),
        owner: name(t.owner), ownerId: t.owner || null, ownerSide: side(t.owner),
        coworkers: strs(t.coworkers).map(name), requestedBy: strs(t.recipients).map(name),
        status: t.status, due: t.due || null, dueSpeakable: speakable(t.due, today) || null,
        overdue: t.status !== "Closed" && typeof t.due === "string" && t.due < today,
        internal: !isShared(t, all), milestone: Boolean(t.milestone), keyDate: t.key === "sign" ? "signature" : t.key === "live" ? "go-live" : null,
        updates: ups.length, lastUpdate: ups.length ? str(ups[ups.length - 1].text, 200) : null,
      };
    }),
  };
}

// Same rules as the page's matches(), so a spoken list and the list on screen agree.
export function listMatches(data: Obj, filter: ListFilter, viewer: string | null, today: string, personId: string | null = null, phaseId: string | null = null): string[] {
  const people = arr(data.people);
  const sideOf = (id: unknown) => people.find(p => p.id === id)?.side;
  const open = (t: Obj) => t.status !== "Closed";
  const test = (t: Obj): boolean => {
    switch (filter) {
      case "mine": return open(t) && (t.owner === viewer || strs(t.coworkers).includes(viewer || "\0"));
      case "tracking": return open(t) && t.owner !== viewer && !strs(t.coworkers).includes(viewer || "\0") && strs(t.recipients).includes(viewer || "\0");
      case "overdue": return open(t) && typeof t.due === "string" && t.due < today;
      case "buyer": return open(t) && sideOf(t.owner) === "buyer";
      case "seller": return open(t) && sideOf(t.owner) === "seller";
      case "internal": return t.shared === false;
      case "person": return Boolean(personId) && open(t) && (t.owner === personId || strs(t.coworkers).includes(personId!) || strs(t.recipients).includes(personId!));
      default: return true;
    }
  };
  const tasks = arr(data.tasks), phases = arr(data.phases).map(p => p.id);
  return tasks.filter(t => test(t) && (!phaseId || t.phase === phaseId))
    .sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase))
    .map(t => String(t.id));
}

export function listLabel(data: Obj, filter: ListFilter, personId: string | null, phaseId: string | null): string {
  const people = arr(data.people), customer = str(data.account) || "the customer";
  const who = str(people.find(p => p.id === personId)?.name) || "that person";
  const base = { all: "tasks", mine: "open tasks of yours", tracking: "open tasks you requested", overdue: "overdue tasks", buyer: `open tasks waiting on ${customer}`, seller: "open tasks waiting on iSEEit", internal: "internal tasks", person: `tasks with ${who}` }[filter];
  const phase = str(arr(data.phases).find(p => p.id === phaseId)?.name);
  return phase ? `${base} in ${phase}` : base;
}

export function describeTask(data: Obj, id: string, today: string): string {
  const t = arr(data.tasks).find(x => x.id === id); if (!t) return "";
  const people = arr(data.people), name = (pid: unknown) => str(people.find(p => p.id === pid)?.name) || "nobody yet";
  const parts = [`${str(t.title)}.`];
  if (str(t.desc).trim()) parts.push(`Details: ${str(t.desc, 400).trim().replace(/([^.!?])$/, "$1.")}`);
  parts.push(`Owner: ${name(t.owner)}.`, `Status: ${t.status}.`, t.due ? `Due ${speakable(t.due, today)}.` : "No due date.");
  const ups = arr(t.updates); if (ups.length) parts.push(`Last update: ${str(ups[ups.length - 1].text, 300)}`);
  if (t.shared === false) parts.push("It's internal.");
  return parts.join(" ");
}

// Keeps only what points at something real: known task, person and phase ids,
// valid statuses and dates, and text the person actually said. Returns why it
// can't be done when nothing is left. (Creating a task goes through completeDraft.)
export function checkProposal(data: Obj, p: Proposal, focusTaskId: string | null, utterance = ""): { ok: true; taskId: string | null; actions: VoiceAction[] } | { ok: false; reason: string } {
  const tasks = arr(data.tasks), people = arr(data.people), phases = arr(data.phases);
  const hasPerson = (id: string | null) => Boolean(id) && people.some(x => x.id === id);
  const taskId = p.taskId && tasks.some(t => t.id === p.taskId) ? p.taskId : p.taskId ? null : focusTaskId && tasks.some(t => t.id === focusTaskId) ? focusTaskId : null;
  if (!taskId) return { ok: false, reason: "I couldn't tell which task you mean. Say part of its name." };
  const task = tasks.find(t => t.id === taskId)!;
  let refused = "";
  const actions = (p.actions || []).filter(a => {
    switch (a.type) {
      case "set_status": return (STATUSES as readonly string[]).includes(a.status || "");
      case "post_update": case "rename": case "set_description": return Boolean(a.text && a.text.trim()) && (!utterance || grounded(a.text!, utterance));
      case "set_due": return Boolean(a.date && DATE.test(a.date));
      case "shift_due": return Number.isInteger(a.days) && a.days !== 0 && Math.abs(a.days!) <= 365 && DATE.test(str(task.due));
      case "set_owner": case "add_coworker": case "add_requester": case "remove_coworker": case "remove_requester": return hasPerson(a.personId);
      case "set_phase":
        if (!a.phaseId || !phases.some(x => x.id === a.phaseId)) return false;
        if (task.parent) { refused = "A subtask stays in the phase of its main task. Move the main task instead."; return false; }
        return true;
      case "set_shared": case "set_milestone": return typeof a.flag === "boolean";
      case "delete_task": return true;
      default: return false;
    }
  }).map(a => ({ ...a, text: a.text ? a.text.trim().slice(0, 2000) : null }));
  if (!actions.length) return { ok: false, reason: refused || "I understood the task but not what to change on it." };
  return { ok: true, taskId, actions };
}

// A draft sent back by the page is untrusted input: keep only what still points
// at something real.
export function sanitizeDraft(data: Obj, raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Obj, tasks = arr(data.tasks), people = arr(data.people), phases = arr(data.phases);
  const title = str(d.title, 200).trim(); if (!title) return null;
  const parent = typeof d.parentId === "string" ? tasks.find(t => t.id === d.parentId) : null;
  return {
    title, parentId: parent ? String(parent.id) : null,
    phaseId: typeof d.phaseId === "string" && phases.some(p => p.id === d.phaseId) ? d.phaseId : null,
    ownerId: typeof d.ownerId === "string" && people.some(p => p.id === d.ownerId) ? d.ownerId : null,
    due: typeof d.due === "string" && DATE.test(d.due) ? d.due : null,
    description: str(d.description, 2000).trim() || null, internal: d.internal === true,
    askedPhase: d.askedPhase === true, askedDetails: d.askedDetails === true,
  };
}

export type DraftResult = { kind: "ask"; draft: Draft; question: string } | { kind: "create"; newTask: Required<Pick<NewTask, "title" | "phaseId" | "parentId" | "ownerId" | "due" | "internal">> & { description: string | null } } | { kind: "error"; reason: string };

// Creating a task takes as many turns as it needs: it checks which phase the
// task belongs in (offering the current one), then asks once for the owner, due
// date and description if they're missing ("skip" or "that's all" ends the
// questions and the task is created with defaults: you as owner, the phase end
// as due date). Subtasks take their phase from the main task and aren't asked
// for a description.
// The AI must not fill in what nobody said (a live test had "add a task: …" become
// a subtask of an existing task, in a phase it guessed): a phase, an owner or a
// parent task only counts when the person's words name it.
export function completeDraft(data: Obj, prevRaw: unknown, n: NewTask | null, utterance: string, today: string, viewer: string | null = null): DraftResult {
  const tasks = arr(data.tasks), people = arr(data.people), phases = arr(data.phases);
  const prev = sanitizeDraft(data, prevRaw);
  const title = prev ? prev.title : n && n.title.trim() && grounded(n.title, utterance) ? n.title.trim().slice(0, 200) : "";
  if (!title) return { kind: "error", reason: "I didn't catch the name of the task." };
  const wantsSub = /\bsub-?tasks?\b/i.test(utterance);
  const named = n?.parentId ? tasks.find(t => t.id === n.parentId) : null;
  if (!prev && n?.parentId && wantsSub && !named) return { kind: "error", reason: "I couldn't find the task to add that subtask to." };
  const parentId = (named && wantsSub ? String(named.id) : null) ?? prev?.parentId ?? null;
  const parent = parentId ? tasks.find(t => t.id === parentId) : null;
  const phaseSaid = typeof n?.phaseId === "string" ? phases.find(p => p.id === n.phaseId && namedIn(utterance, str(p.name))) : null;
  const phaseId = parent ? String(parent.phase) : (phaseSaid ? String(phaseSaid.id) : null) ?? prev?.phaseId ?? null;
  const personSaid = typeof n?.ownerId === "string" ? people.find(p => p.id === n.ownerId && (namedIn(utterance, str(p.name)) || (p.id === viewer && /\b(me|myself|mine|i)\b/i.test(utterance)))) : null;
  const ownerId = (personSaid ? String(personSaid.id) : null) ?? prev?.ownerId ?? null;
  const dateSaid = mentionsDate(utterance);
  const due = (typeof n?.due === "string" && DATE.test(n.due) && dateSaid ? n.due : null) ?? prev?.due ?? null;
  const said = n?.description && n.description.trim() && grounded(n.description, utterance) ? n.description.trim().slice(0, 2000) : null;
  const description = said ?? prev?.description ?? null;
  const internal = parent ? parent.shared === false : Boolean(n?.internal) || Boolean(prev?.internal);
  const declined = Boolean(n?.done);
  const draft: Draft = { title, phaseId, parentId, ownerId, due, description, internal, askedPhase: prev?.askedPhase ?? false, askedDetails: prev?.askedDetails ?? false };
  const current = phases.find(p => str(p.start) <= today && today <= str(p.end)) || phases[0];
  const phaseName = (id: string | null) => str(phases.find(p => p.id === id)?.name);

  if (!phaseId) {
    if (!draft.askedPhase && !declined) {
      return { kind: "ask", draft: { ...draft, askedPhase: true }, question: `Which phase should "${title}" go in?${current ? ` You're in ${str(current.name)} right now.` : ""}` };
    }
    draft.phaseId = current ? String(current.id) : null;
  }
  if (!draft.phaseId) return { kind: "error", reason: "This plan has no phases yet." };

  const missing = [!ownerId && "owner", !due && "due", !parent && !description && "description"].filter(Boolean) as string[];
  if (missing.length && !draft.askedDetails && !declined) {
    const part = { owner: "who should own it", due: "when it's due", description: "anything for the description" } as Record<string, string>;
    const parts = missing.map(m => part[m]);
    const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return { kind: "ask", draft: { ...draft, askedDetails: true }, question: `For "${title}" in ${phaseName(draft.phaseId)}: ${joined.replace(/^./, c => c.toUpperCase())}? Or say skip.` };
  }
  return { kind: "create", newTask: { title, phaseId: draft.phaseId, parentId, ownerId, due, description, internal } };
}

// Closing a task and moving a milestone's date ask for a yes first (a live
// session closed a task on a misheard "tick this off").
export function confirmQuestion(data: Obj, taskId: string, actions: VoiceAction[], today: string): string | null {
  const t = arr(data.tasks).find(x => x.id === taskId); if (!t) return null;
  if (actions.some(a => a.type === "delete_task")) {
    const kids = arr(data.tasks).filter(k => k.parent === taskId).length;
    return `Delete "${str(t.title)}"${kids ? ` and its ${kids} subtask${kids > 1 ? "s" : ""}` : ""}? This can't be undone. Say yes to confirm.`;
  }
  // Ticking off a subtask is a checkbox that is easily unticked: no question. Closing a main task asks.
  const closing = actions.some(a => a.type === "set_status" && a.status === "Closed") && !t.parent;
  const move = actions.find(a => a.type === "set_due" || a.type === "shift_due");
  if (closing) return `Close "${str(t.title)}"? Say yes to confirm.`;
  if (move && t.milestone) return `Move the milestone "${str(t.title)}" to ${speakable(move.type === "shift_due" ? addDays(str(t.due), move.days || 0) : move.date, today)}? Say yes to confirm.`;
  return null;
}

export function describeActions(data: Obj, taskId: string, actions: VoiceAction[], today: string): string {
  const t = arr(data.tasks).find(x => x.id === taskId), people = arr(data.people);
  const name = (id: string | null) => str(people.find(p => p.id === id)?.name);
  const title = str(t?.title);
  return actions.map(a => {
    switch (a.type) {
      case "set_status":
        if (t?.parent) return a.status === "Closed" ? `Ticked off the subtask "${title}".` : a.status === "Open" ? `Unticked the subtask "${title}".` : `Set the subtask "${title}" to ${a.status}.`;
        return a.status === "Closed" ? `Closed "${title}".` : `Set "${title}" to ${a.status}.`;
      case "set_phase": return `Moved "${title}" to ${str(arr(data.phases).find(p => p.id === a.phaseId)?.name)}.`;
      case "set_shared": return a.flag ? `"${title}" is now shared with the customer.` : `"${title}" is now internal.`;
      case "set_milestone": return a.flag ? `"${title}" is now a milestone.` : `"${title}" is no longer a milestone.`;
      case "remove_coworker": return `Took ${name(a.personId)} off as coworker.`;
      case "remove_requester": return `Took ${name(a.personId)} off requested by.`;
      case "post_update": return `Posted your update on "${title}".`;
      case "set_due": return `Moved "${title}" to ${speakable(a.date, today)}.`;
      case "shift_due": return `Moved "${title}" ${shiftWords(a.days)} to ${speakable(addDays(str(t?.due), a.days || 0), today)}.`;
      case "set_owner": return `${name(a.personId)} now owns "${title}".`;
      case "rename": return `Renamed it to "${a.text}".`;
      case "set_description": return `Updated the details of "${title}".`;
      case "add_coworker": return `Added ${name(a.personId)} as coworker.`;
      case "add_requester": return `Added ${name(a.personId)} under requested by.`;
      case "delete_task": return `Deleted "${title}".`;
    }
  }).join(" ");
}

// What the close plan voice assistant can do, in the words a person would use.
// One list for the "What can I say?" panel, the spoken answer to "what can you
// do?" and (later) the guided tour, so help never promises more than exists.
// Lines with "…" are patterns to say, not to tap.
export function capabilities(customer: string, phase: string, person: string): Capability[] {
  return [
    { group: "Ask", items: ["Where do we stand?", "What should I do next?", "What's overdue?"] },
    { group: "Catch up", items: ["Give me a briefing", "What's up next?", "What's new?", "Any client activity?", "What did … do this week?"] },
    { group: "Find", items: [`What is ${customer} waiting on?`, `What are we waiting on from ${customer}?`, "Show my tasks", `What's left in ${phase}?`, "Show the internal tasks", "Next"] },
    { group: "Change a task", items: ["Open the … task", "Post an update: …", "Mark it done", "Set it to in progress", "Move it to next Friday", `Assign it to ${person}`, `Add ${person} as coworker`, `Take ${person} off as coworker`, `Move it to ${phase}`, "Rename it to …", "Change the description to …", "Make it internal", "Share it with the customer", "Mark it as a milestone", "Delete it"] },
    { group: "Subtask checkboxes", items: ["Tick off the … subtask", "Untick the … subtask"] },
    { group: "Phases", items: [`Rename ${phase} to …`, `Move the end of ${phase} to …`, `Change the start of ${phase} to …`, `Change the description of ${phase} to …`, "Add a phase … from … to …", `Delete the phase ${phase}`, "Collapse the … phase", "Expand all phases", "Put the phases in date order", "Move the whole plan back four weeks"] },
    { group: "Many tasks at once", items: [`Make all tasks in ${phase} internal`, "Close all of these", "Move them all to Friday", "Move … , … and … back one week", "Mark … and … as open"] },
    { group: "Add", items: ["Add a task: …", `Add a task to ${phase}: …, owner ${person}, due Friday`, "Add a subtask to …: …"] },
    { group: "Ideas", items: ["I wish you could …"] },
  ];
}
export const HELP_SPOKEN = (customer: string) => `I can give you a briefing, tell you what's new, tell you where the plan stands and what to do next, change phases (rename, move the start or end date, change the description, add or delete one), show lists like what ${customer} is waiting on or what's overdue, open and walk through tasks, post updates, change any field of a task like status, phase, dates, owners and the description, tick off subtasks, and add tasks, asking you for the phase, owner, due date and description if you leave them out. The full list is in the panel under "What can I say?". And if you wish I could do something else, just tell me.`;
export { isHelpRequest };

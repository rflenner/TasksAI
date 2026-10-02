// Close Plan voice assistant: the plan as the assistant sees it, the lists it
// can show, and the checks on what the AI proposes. Pure and DB-free so the
// rules are unit-tested (tests/close-plan-voice.test.ts); the route in
// app/api/close-plans/voice does the AI call, and the page applies the
// changes itself, through the same functions (and access rules) as a click.
//
// Built for the iSEEit team first. `audience` is already part of the shape so
// a customer contact's view (internal tasks removed, see customerView in
// close-plan-share.ts) can use the same assistant later.

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : [];
const str = (v: unknown, max = 300) => typeof v === "string" ? v.slice(0, max) : "";

// The page's own task filters (prototype/close-plan-demo.html, matches()).
export const LIST_FILTERS = ["all", "mine", "tracking", "overdue", "buyer", "seller", "internal", "person"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];
export const STATUSES = ["Open", "In progress", "Closed"] as const;
export const ACTION_TYPES = ["set_status", "post_update", "set_due", "set_owner", "rename", "set_description", "add_coworker", "add_requester"] as const;

export type VoiceAction = { type: (typeof ACTION_TYPES)[number]; status: string | null; text: string | null; date: string | null; personId: string | null };
export type NewTask = { title: string; phaseId: string | null; parentId: string | null; ownerId: string | null; due: string | null; internal: boolean };
export type Proposal = {
  mode: "answer" | "open_task" | "list" | "next" | "act" | "add_task" | "unsupported" | "wish" | "unclear";
  answer: string; taskId: string | null; filter: ListFilter | null; personId: string | null; phaseId: string | null;
  actions: VoiceAction[]; newTask: NewTask | null; requestName?: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
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

// The next three weeks with their weekdays, so "Friday" or "next Tuesday" lands
// on the right date (a live test turned "due Friday" into a Thursday).
export function calendar(today: string, days = 21): string {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    out.push(`${d.toISOString().slice(0, 10)} ${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`);
  }
  return out.join(", ");
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
      case "person": return Boolean(personId) && (t.owner === personId || strs(t.coworkers).includes(personId!) || strs(t.recipients).includes(personId!));
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

// Text written into a task (an update, a new title or details) must come from
// what the person said: a live test had "mark it done" also post an update
// "Marked complete per your request." that nobody said.
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(w => w.length >= 3);
export function grounded(text: string, utterance: string): boolean {
  const said = new Set(words(utterance)), own = words(text);
  if (!own.length) return false;
  return own.filter(w => said.has(w)).length / own.length >= 0.6;
}

// Keeps only what points at something real: known task, person and phase ids,
// valid statuses and dates, and text the person actually said. Returns why it
// can't be done when nothing is left.
export function checkProposal(data: Obj, p: Proposal, focusTaskId: string | null, utterance = ""): { ok: true; taskId: string | null; actions: VoiceAction[]; newTask: NewTask | null } | { ok: false; reason: string } {
  const tasks = arr(data.tasks), people = arr(data.people), phases = arr(data.phases);
  const hasPerson = (id: string | null) => Boolean(id) && people.some(x => x.id === id);
  if (p.mode === "add_task") {
    const n = p.newTask;
    if (!n || !n.title.trim() || (utterance && !grounded(n.title, utterance))) return { ok: false, reason: "I didn't catch the name of the task." };
    const parent = n.parentId ? tasks.find(t => t.id === n.parentId) : null;
    if (n.parentId && !parent) return { ok: false, reason: "I couldn't find the task to add that subtask to." };
    const phaseId = parent ? String(parent.phase) : n.phaseId && phases.some(x => x.id === n.phaseId) ? n.phaseId : null;
    if (!phaseId) return { ok: false, reason: "Which phase should it go in?" };
    return { ok: true, taskId: null, actions: [], newTask: { title: n.title.trim().slice(0, 200), phaseId, parentId: parent ? String(parent.id) : null, ownerId: hasPerson(n.ownerId) ? n.ownerId : null, due: n.due && DATE.test(n.due) ? n.due : null, internal: Boolean(n.internal) } };
  }
  const taskId = p.taskId && tasks.some(t => t.id === p.taskId) ? p.taskId : p.taskId ? null : focusTaskId && tasks.some(t => t.id === focusTaskId) ? focusTaskId : null;
  if (!taskId) return { ok: false, reason: "I couldn't tell which task you mean. Say part of its name." };
  const actions = (p.actions || []).filter(a => {
    switch (a.type) {
      case "set_status": return (STATUSES as readonly string[]).includes(a.status || "");
      case "post_update": case "rename": case "set_description": return Boolean(a.text && a.text.trim()) && (!utterance || grounded(a.text!, utterance));
      case "set_due": return Boolean(a.date && DATE.test(a.date));
      case "set_owner": case "add_coworker": case "add_requester": return hasPerson(a.personId);
      default: return false;
    }
  }).map(a => ({ ...a, text: a.text ? a.text.trim().slice(0, 2000) : null }));
  if (!actions.length) return { ok: false, reason: "I understood the task but not what to change on it." };
  return { ok: true, taskId, actions, newTask: null };
}

// Closing a task and moving a milestone's date ask for a yes first (a live
// session closed a task on a misheard "tick this off").
export function confirmQuestion(data: Obj, taskId: string, actions: VoiceAction[], today: string): string | null {
  const t = arr(data.tasks).find(x => x.id === taskId); if (!t) return null;
  const closing = actions.some(a => a.type === "set_status" && a.status === "Closed");
  const move = actions.find(a => a.type === "set_due") ;
  if (closing) return `Close "${str(t.title)}"? Say yes to confirm.`;
  if (move && t.milestone) return `Move the milestone "${str(t.title)}" to ${speakable(move.date, today)}? Say yes to confirm.`;
  return null;
}

export function describeActions(data: Obj, taskId: string, actions: VoiceAction[], today: string): string {
  const t = arr(data.tasks).find(x => x.id === taskId), people = arr(data.people);
  const name = (id: string | null) => str(people.find(p => p.id === id)?.name);
  const title = str(t?.title);
  return actions.map(a => {
    switch (a.type) {
      case "set_status": return a.status === "Closed" ? `Closed "${title}".` : `Set "${title}" to ${a.status}.`;
      case "post_update": return `Posted your update on "${title}".`;
      case "set_due": return `Moved "${title}" to ${speakable(a.date, today)}.`;
      case "set_owner": return `${name(a.personId)} now owns "${title}".`;
      case "rename": return `Renamed it to "${a.text}".`;
      case "set_description": return `Updated the details of "${title}".`;
      case "add_coworker": return `Added ${name(a.personId)} as coworker.`;
      case "add_requester": return `Added ${name(a.personId)} under requested by.`;
    }
  }).join(" ");
}

// What the close plan voice assistant can do, in the words a person would use.
// One list for the "What can I say?" panel, the spoken answer to "what can you
// do?" and (later) the guided tour, so help never promises more than exists.
// Lines with "…" are patterns to say, not to tap.
export type Capability = { group: string; items: string[] };
export function capabilities(customer: string, phase: string, person: string): Capability[] {
  return [
    { group: "Ask", items: ["Where do we stand?", "What should I do next?", "What's overdue?"] },
    { group: "Find", items: [`What is ${customer} waiting on?`, `What are we waiting on from ${customer}?`, "Show my tasks", `What's left in ${phase}?`, "Show the internal tasks", "Next"] },
    { group: "Change a task", items: ["Open the … task", "Post an update: …", "Mark it done", "Move it to next Friday", `Assign it to ${person}`, `Add ${person} as coworker`] },
    { group: "Add", items: [`Add a task to ${phase}: …`, "Add a subtask: …, due …"] },
    { group: "Ideas", items: ["I wish you could …"] },
  ];
}
export const HELP_SPOKEN = (customer: string) => `I can tell you where the plan stands and what to do next, show lists like what ${customer} is waiting on or what's overdue, open and walk through tasks, post updates, change status, dates and owners, and add tasks or subtasks. The full list is in the panel under "What can I say?". And if you wish I could do something else, just tell me.`;
export const isHelpRequest = (u: string) => /\b(what can (you|i) (do|say|ask)|what are you able to do|how (can|do) (you|i) (help|use you)|what do you (do|know))\b|^\s*help\b/i.test(u);

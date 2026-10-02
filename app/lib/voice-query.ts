// Pure, DB-free logic for the voice assistant's classify-and-act
// pipeline — split out of app/api/voice-query/route.ts the same way
// every other piece of business logic this session was (task-merge.ts,
// sales-ai-mapping.ts, task-activity.ts). Matters more here than usual:
// the actual classification step needs a live OPENAI_API_KEY, which most
// dev/test environments don't have configured, so this is the only part
// of the voice assistant that can realistically be verified without one.
import type { ChecklistItem, tasks } from "../../db/schema";
import { matchChecklistItem } from "./checklist";

export type StoredTask = typeof tasks.$inferSelect;

export type Filters = {
  owner: string | null;
  mineOnly: boolean;
  // Generalizes mineOnly (which has always meant "owner, and only
  // owner" — matches the My tasks page's own default) to the other two
  // relationships a task can have to someone: requested 2026-09-08 for
  // "what's due where I'm the reporter/recipient", a genuinely different
  // question from "my tasks". Additive, not a replacement — mineOnly
  // keeps its exact existing meaning when myRole is null.
  myRole: "collaborator" | "recipient" | null;
  project: string | null;
  topic: string | null;
  recurringMeeting: string | null;
  account: string | null;
  opportunity: string | null;
  source: string | null;
  priority: "Low" | "Medium" | "High" | null;
  dueWithin: "week" | "overdue" | null;
  createdWithin: "today" | null;
  closedWithin: "today" | null;
  status: string | null;
  // Free-text search — requested 2026-09-08 after "identify all tasks
  // that have playbook in their subject line" fell into "answer" mode
  // (a one-off read-out) instead of a real filter, so the follow-up
  // "add this to all of these" had nothing to act on. A real filter
  // narrows the screen AND seeds the working list "act" can bulk-apply
  // to (see ActionStep/target below) — the missing link that turn needed.
  textContains: string | null;
  // "What's new" / "show me new tasks" — requested 2026-09-09 alongside
  // the on-screen NEW badge (see app/lib/task-flags.ts): the same
  // per-actor flag, just usable as a filter too. Membership is supplied
  // by the caller (isNewTaskIds, computed once per request from the
  // DB-backed view/assignment context) rather than recomputed here —
  // this file stays DB-free, same reason StoredTask itself never carries
  // per-actor fields.
  isNew: boolean;
  // "Have there been updates on the tasks I reported?" — requested
  // 2026-09-11 alongside the on-screen "New status update" badge (see
  // hasUnseenUpdateFor in app/lib/task-flags.ts): same per-actor,
  // clears-on-open flag, same "membership supplied by the caller"
  // shape as isNew above.
  hasUnseenUpdate: boolean;
};

// Same "how long ago" reasoning as the Users & access page's own
// lastActive() formatter, phrased for speech rather than a UI label —
// "about 3 hours ago" reads naturally out loud, "Active 3h ago" doesn't.
export function describeLastActive(lastSeenAt: Date | null): string {
  if (!lastSeenAt) return "never signed in";
  const minutes = Math.round((Date.now() - lastSeenAt.getTime()) / 60000);
  if (minutes < 1) return "active just now";
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (minutes < 1440) { const hours = Math.round(minutes / 60); return `about ${hours} hour${hours === 1 ? "" : "s"} ago`; }
  const days = Math.round(minutes / 1440);
  if (days < 14) return `about ${days} day${days === 1 ? "" : "s"} ago`;
  return `on ${lastSeenAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
}

// Every raw date (due/created/closedAt) handed to the model comes with
// one of these alongside it — confirmed live 2026-09-04: asked about a
// due date, the model just echoed the raw "2026-09-07" back, which reads
// as something close to digit-by-digit once spoken. Reasoning/sorting
// can still use the raw ISO date; only speech needs this.
export function speakableDate(dateStr: string | null | undefined): string | null {
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

// Same phrasing as TaskApp.js's client-side notifyDraftMessage (the bell
// icon's own default message), minus that function's multi-recipient
// name-joining — a voice-triggered notify (requested 2026-10-02, "most
// of the time I would like to notify someone that owns a task") only
// ever targets one person at a time, so there's nothing to join. Kept
// as its own small duplicate rather than sharing the client's function
// directly: that one lives in a "use client" component and can't be
// imported into this server-side, DB-free module without pulling
// browser-only code across the server/client boundary.
export function draftNotifyMessage(subject: string, due: string | null, toFirstName: string): string {
  const dueClause = due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? `, due ${new Date(`${due}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  return `Hi ${toFirstName},\n\nJust a reminder about "${subject}"${dueClause}. Please let me know if you need any support or if you're still on track.\n\nThanks!`;
}

// Shared by "walk"'s first task and wherever a task gets handed back to
// the user to act on next (standalone "next", a chained goto_next
// inside "act", or "next" resuming a briefing's own working list) —
// one consistent read-out everywhere that happens. Requested 2026-09-08
// to also say status and the last status update (when there is one) —
// exactly what a coffee-morning triage pass actually needs to know
// before deciding what to do with a task, not just its due date.
export function describeTaskForWalk(t: StoredTask): string {
  const parts = [`${t.subject}.`];
  const description = t.description.trim();
  if (description) parts.push(/[.!?]$/.test(description) ? description : `${description}.`);
  parts.push(`Status: ${t.status}.`);
  parts.push(t.due ? `Due ${speakableDate(t.due)}.` : "No due date.");
  if (t.updates.length) parts.push(`Last update: ${t.updates[t.updates.length - 1].text}`);
  parts.push("What do you want me to do?");
  return parts.join(" ");
}

// Deterministic list-walk, shared by mode="next" and mode="act"'s
// trailing goto_next step — never left to the model, which has no way
// to know what came after what in a UI it can't see. Skips past any id
// that's no longer visible (deleted, or permissions changed) instead of
// dead-ending on it.
export function resolveNext(currentTaskId: number | null, list: number[], visible: StoredTask[]): StoredTask | null {
  const currentIndex = currentTaskId != null ? list.indexOf(currentTaskId) : -1;
  let idx = currentIndex + 1;
  while (idx < list.length) {
    const candidate = visible.find(t => t.id === list[idx]);
    if (candidate) return candidate;
    idx++;
  }
  return null;
}

// Where "next" counts from. The open task when it's on the list being
// walked — otherwise the last list item the person was on (the client's
// cursor), so opening or asking about a task OFF the list and then saying
// "next" carries on from where the walk was, instead of restarting at the
// top (resolveNext treats a task that isn't on the list as "before the
// first one" — which is what made a live walk through overdue tasks keep
// jumping back to the start).
export function listAnchor(currentTaskId: number | null, cursorTaskId: number | null, list: number[]): number | null {
  if (currentTaskId != null && list.includes(currentTaskId)) return currentTaskId;
  if (cursorTaskId != null && list.includes(cursorTaskId)) return cursorTaskId;
  return null;
}

// "open the first one" was classified as navigate -> Dictate twice in one
// live session (2026-10-02), which leaves the page entirely and ends the
// live session — it looked like a crash. A screen change is only honoured
// when the person's own words actually name that screen; anything else the
// classifier proposed is treated as a mistake.
const NAVIGATE_WORDS: Record<"dictate" | "new_task" | "paste_minutes", RegExp> = {
  dictate: /\bdictat/i,
  new_task: /\b(new|create|add|start)\b.*\b(task|action|item)\b/i,
  paste_minutes: /\bminutes\b|\bmeeting notes\b/i,
};
export function navigationAllowed(target: "dictate" | "new_task" | "paste_minutes", spoken: string): boolean {
  return NAVIGATE_WORDS[target].test(spoken);
}

// "the first one" / "the second task" / "the last one" against the list on
// screen — resolved here, not left to the classifier: a live check showed
// it answering "open the first one" with the first task of the WHOLE task
// list while an overdue list was on screen. Only word ordinals, and only
// when the phrase points at the list ("the first one", "the last task") —
// "the first task in the pilot project" is a new search, not a list
// position. Returns null when there is no list, no ordinal, or the list
// has no such position (the caller then falls back to the classifier).
const ORDINAL_VALUES: Record<string, number> = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5,
  sixth: 6, "6th": 6, seventh: 7, "7th": 7, eighth: 8, "8th": 8, ninth: 9, "9th": 9, tenth: 10, "10th": 10,
};
export function resolveListOrdinal(spoken: string, listIds: number[], visible: StoredTask[]): number | null {
  const match = /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|ninth|9th|tenth|10th|last|final)\b(\s+(?:one|task|item)\b)?(\s+(?:in|of|for|from|with|on|about|by|at)\b)?/i.exec(spoken);
  if (!match) return null;
  const pointsAtList = Boolean(match[2]) || /^\W*$/.test(spoken.slice(match.index + match[0].length));
  if (!pointsAtList || match[3]) return null;
  const visibleIds = new Set(visible.map(t => t.id));
  const ids = listIds.filter(id => visibleIds.has(id));
  const word = match[1].toLowerCase();
  const position = word === "last" || word === "final" ? ids.length : ORDINAL_VALUES[word];
  return position >= 1 && position <= ids.length ? ids[position - 1] : null;
}

// Names that are never a person to assign a task to — the product's own
// automation names. "Sales AI" was written into a task's owner (and then
// into the people suggestion list) by a mis-heard assignment.
const NOT_A_PERSON = /^(sales ai|task ai|task ai voice assistant|voice assistant|nobody|no one|none|unassigned)$/i;

// Resolves a spoken name against names Task AI already knows: exact, or a
// first name that identifies exactly one person. Null when it doesn't
// resolve (so the caller can say so rather than invent an owner).
export function resolveKnownPerson(spoken: string, candidates: string[]): string | null {
  const s = spoken.trim().toLowerCase();
  if (!s || NOT_A_PERSON.test(s)) return null;
  const usable = candidates.filter(c => c.trim() && !NOT_A_PERSON.test(c.trim()));
  const exact = usable.find(c => c.toLowerCase() === s);
  if (exact) return exact;
  const byFirst = [...new Set(usable.filter(c => c.toLowerCase().split(/\s+/)[0] === s))];
  return byFirst.length === 1 ? byFirst[0] : null;
}

// Shared by "filter" and "walk" — the exact same matching rules; only
// what happens with the result differs.
export function computeMatches(f: Filters, visible: StoredTask[], actorName: string, today: string, weekAhead: string, isNewTaskIds: ReadonlySet<number> = new Set(), unseenUpdateTaskIds: ReadonlySet<number> = new Set()): StoredTask[] {
  return visible.filter(t => {
    if (f.isNew && !isNewTaskIds.has(t.id)) return false;
    if (f.hasUnseenUpdate && !unseenUpdateTaskIds.has(t.id)) return false;
    // Owner only — matches the My tasks page's own default. Confirmed
    // live 2026-09-08: "my overdue tasks" said 41 while "overdue tasks
    // where I am the owner" said 3 — the old, broader owner-OR-
    // collaborator-OR-recipient match was a real, confusing mismatch
    // against what the same words mean on screen.
    if (f.mineOnly && t.owner !== actorName) return false;
    if (f.myRole === "collaborator" && !t.collaborators.includes(actorName)) return false;
    if (f.myRole === "recipient" && !t.recipients.includes(actorName)) return false;
    if (f.owner && t.owner.toLowerCase() !== f.owner.toLowerCase() && !t.owner.toLowerCase().includes(f.owner.toLowerCase())) return false;
    if (f.project && t.project !== f.project) return false;
    if (f.topic && t.topic !== f.topic) return false;
    if (f.recurringMeeting && t.recurringMeeting !== f.recurringMeeting) return false;
    // Account/opportunity/source — added 2026-09-08 alongside the same
    // three dimensions becoming real sidebar/group-by options in the UI;
    // voice had no way to reach them at all until now.
    if (f.account && t.accountName !== f.account) return false;
    if (f.opportunity && t.opportunityName !== f.opportunity) return false;
    if (f.source && t.source !== f.source) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.textContains && !`${t.subject} ${t.description}`.toLowerCase().includes(f.textContains.toLowerCase())) return false;
    if (f.dueWithin === "overdue" && !(t.due && t.due < today && t.status !== "Closed")) return false;
    if (f.dueWithin === "week" && !(t.due && t.due >= today && t.due <= weekAhead && t.status !== "Closed")) return false;
    if (f.createdWithin === "today" && t.created.slice(0, 10) !== today) return false;
    if (f.closedWithin === "today" && (!t.closedAt || t.closedAt.toISOString().slice(0, 10) !== today)) return false;
    return true;
  });
}

export function describeFilterPhrase(f: Filters): string {
  const parts: string[] = [];
  // Spells out "tasks you own" rather than the vaguer "your tasks" —
  // states the scope plainly in the answer itself, rather than leaving
  // "mine" to be silently reinterpreted differently turn to turn.
  if (f.mineOnly) parts.push("tasks you own");
  else if (f.myRole === "collaborator") parts.push("tasks where you're a coworker");
  else if (f.myRole === "recipient") parts.push("tasks where you're the recipient");
  else if (f.owner) parts.push(`tasks for ${f.owner}`);
  else parts.push("tasks");
  if (f.project) parts.push(`in ${f.project}`);
  if (f.topic) parts.push(`on ${f.topic}`);
  if (f.recurringMeeting) parts.push(`for ${f.recurringMeeting}`);
  if (f.account) parts.push(`for the ${f.account} account`);
  if (f.opportunity) parts.push(`on the ${f.opportunity} opportunity`);
  if (f.source) parts.push(`from ${f.source}`);
  if (f.priority) parts.push(`marked ${f.priority} priority`);
  if (f.status) parts.push(`with status ${f.status}`);
  if (f.textContains) parts.push(`with "${f.textContains}" in the subject or description`);
  if (f.isNew) parts.push("flagged new");
  if (f.hasUnseenUpdate) parts.push("with a new status update");
  if (f.dueWithin === "week") parts.push("due this week");
  if (f.dueWithin === "overdue") parts.push("that are overdue");
  if (f.createdWithin === "today") parts.push("created today");
  if (f.closedWithin === "today") parts.push("closed today");
  return parts.join(" ");
}

// One entry in an "act" mode command — an ordered list of writes against
// whichever task is currently in focus. delete_task and goto_next are
// deliberately NOT handled by applyActionSteps below: delete needs its
// own confirm-then-execute round trip (see mergeTasks-style caution
// elsewhere in this app for anything irreversible), and goto_next needs
// the same resolveNext/workingList machinery standalone "next" uses —
// both stay in the route itself.
export type ActionStep = {
  type: "set_due" | "set_status" | "set_priority" | "set_owner" | "set_subject" | "set_description" | "set_project" | "set_topic"
      | "add_collaborator" | "remove_collaborator" | "add_recipient" | "remove_recipient"
      | "add_update" | "add_checklist_item" | "set_checklist_item_done" | "delete_task" | "goto_next" | null;
  dueDate: string | null; status: string | null; priority: string | null; owner: string | null;
  // One shared slot for every "set this text field" / "append this
  // text" step (subject, description, project, topic, add_update,
  // add_checklist_item's new text, set_checklist_item_done's spoken
  // match phrase) — consolidated from four separate fields
  // (subjectText/descriptionText/updateText, plus what would have been
  // two more for project/topic) requested 2026-09-08 specifically to
  // *shrink* the schema while adding set_project/set_topic, not grow it
  // further — this route's own prior growth was a real contributor to a
  // live latency regression (see app/api/voice-query/route.ts). `type`
  // alone already disambiguates which field a value is meant for, so
  // every later addition (including these two checklist steps,
  // requested 2026-10-02) reuses this same slot rather than adding
  // another near-identical dedicated one.
  textValue: string | null;
  personName: string | null;
  // set_checklist_item_done only — true to check it off, false to
  // un-check it. Not reused from `status`/explicit-boolean-free fields
  // above since none of them mean "done" in any other step's context.
  checklistDone: boolean | null;
};

export type ActionResult = {
  updated: {
    subject: string; description: string; owner: string; collaborators: string[]; recipients: string[];
    due: string; status: string; priority: string; project: string; topic: string;
    updates: Array<{ text: string; at: string; by?: string }>;
    checklist: ChecklistItem[];
  };
  confirmations: string[];
  explicitStatus: string | null;
  updatesGrew: boolean;
  error: string | null;
};

// Applies an ordered list of field changes to one task, purely — no DB,
// no network — so every field an "act" command can touch, and every one
// of its error messages, is unit-testable without a live OpenAI call.
// The caller (voice-query's route) does the actual DB write, the
// autoAdvanceStatus/closedAt transition (same rule PATCH /api/tasks
// uses), and the activity-log recording once this returns cleanly.
// Stops at the first bad step and returns its error — a command that's
// partly malformed shouldn't silently apply only the parts that parsed.
export function applyActionSteps(current: StoredTask, steps: ActionStep[], actorName: string, knownPeople: string[], ownerCandidates?: string[]): ActionResult {
  const updated = {
    subject: current.subject, description: current.description, owner: current.owner,
    collaborators: [...current.collaborators], recipients: [...current.recipients],
    due: current.due, status: current.status, priority: current.priority,
    project: current.project, topic: current.topic,
    updates: [...current.updates],
    checklist: [...current.checklist],
  };
  const confirmations: string[] = [];
  let explicitStatus: string | null = null;
  let updatesGrew = false;
  // Exact-match preferred over whatever was spoken — same reasoning as
  // set_owner already had: a real registered/known name is a much safer
  // thing to silently substitute onto than an arbitrary transcribed string.
  const resolvePerson = (spoken: string) => knownPeople.find(p => p.toLowerCase() === spoken.toLowerCase()) ?? spoken;
  const fail = (error: string): ActionResult => ({ updated, confirmations, explicitStatus, updatesGrew, error });

  for (const a of steps) {
    if (a.type === "set_due") {
      if (a.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) return fail("I didn't catch what date to set — try naming the day again.");
      updated.due = a.dueDate ?? "";
      confirmations.push(a.dueDate ? `Moved the due date to ${speakableDate(a.dueDate)}.` : "Cleared the due date.");
    } else if (a.type === "set_status") {
      if (!a.status) return fail("I didn't catch what status to set.");
      updated.status = a.status; explicitStatus = a.status;
      confirmations.push(`Marked it ${a.status}.`);
    } else if (a.type === "set_priority") {
      if (!a.priority) return fail("I didn't catch what priority to set.");
      updated.priority = a.priority;
      confirmations.push(`Set priority to ${a.priority}.`);
    } else if (a.type === "set_owner") {
      if (!a.owner?.trim()) return fail("I didn't catch who to assign this to.");
      // When the caller supplies who Task AI actually knows, an owner has
      // to resolve to one of them — a mis-heard or invented name is
      // refused instead of being written onto the task (and from there
      // into the people suggestion list).
      if (ownerCandidates) {
        const person = resolveKnownPerson(a.owner, ownerCandidates);
        if (!person) return fail(`I don't know anyone called "${a.owner.trim()}" on Task AI, so I haven't changed the owner — say the full name of someone already on a task.`);
        updated.owner = person;
      } else updated.owner = resolvePerson(a.owner.trim());
      confirmations.push(`Assigned it to ${updated.owner}.`);
    } else if (a.type === "set_subject") {
      if (!a.textValue?.trim()) return fail("I didn't catch the new subject.");
      updated.subject = a.textValue.trim().slice(0, 140);
      confirmations.push("Updated the subject.");
    } else if (a.type === "set_description") {
      if (!a.textValue?.trim()) return fail("I didn't catch the new description.");
      updated.description = a.textValue.trim();
      confirmations.push("Updated the description.");
    } else if (a.type === "set_project") {
      if (!a.textValue?.trim()) return fail("I didn't catch the new project.");
      updated.project = a.textValue.trim();
      confirmations.push(`Set the project to ${updated.project}.`);
    } else if (a.type === "set_topic") {
      if (!a.textValue?.trim()) return fail("I didn't catch the new topic.");
      updated.topic = a.textValue.trim();
      confirmations.push(`Set the topic to ${updated.topic}.`);
    } else if (a.type === "add_collaborator") {
      if (!a.personName?.trim()) return fail("I didn't catch who to add as a coworker.");
      const name = resolvePerson(a.personName.trim());
      if (!updated.collaborators.includes(name)) updated.collaborators.push(name);
      confirmations.push(`Added ${name} as a coworker.`);
    } else if (a.type === "remove_collaborator") {
      if (!a.personName?.trim()) return fail("I didn't catch who to remove as a coworker.");
      const name = resolvePerson(a.personName.trim());
      updated.collaborators = updated.collaborators.filter(p => p.toLowerCase() !== name.toLowerCase());
      confirmations.push(`Removed ${name} as a coworker.`);
    } else if (a.type === "add_recipient") {
      if (!a.personName?.trim()) return fail("I didn't catch who to add as a recipient.");
      const name = resolvePerson(a.personName.trim());
      if (!updated.recipients.includes(name)) updated.recipients.push(name);
      confirmations.push(`Added ${name} as a recipient.`);
    } else if (a.type === "remove_recipient") {
      if (!a.personName?.trim()) return fail("I didn't catch who to remove as a recipient.");
      const name = resolvePerson(a.personName.trim());
      updated.recipients = updated.recipients.filter(p => p.toLowerCase() !== name.toLowerCase());
      confirmations.push(`Removed ${name} as a recipient.`);
    } else if (a.type === "add_update") {
      if (!a.textValue?.trim()) return fail("I didn't catch what to add as an update.");
      updated.updates.push({ text: a.textValue.trim(), at: new Date().toISOString(), by: actorName });
      updatesGrew = true;
      confirmations.push("Added the update.");
    } else if (a.type === "add_checklist_item") {
      if (!a.textValue?.trim()) return fail("I didn't catch what to add to the checklist.");
      const text = a.textValue.trim();
      updated.checklist.push({ id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`, text, done: false });
      confirmations.push(`Added "${text}" to the checklist.`);
    } else if (a.type === "set_checklist_item_done") {
      if (!a.textValue?.trim()) return fail("I didn't catch which checklist item you meant.");
      if (!updated.checklist.length) return fail("There's no checklist on this task yet.");
      const match = matchChecklistItem(updated.checklist, a.textValue);
      if (!match) return fail(`I couldn't find a checklist item matching "${a.textValue.trim()}".`);
      const done = a.checklistDone ?? true;
      updated.checklist = updated.checklist.map(item => item.id === match.id ? { ...item, done } : item);
      confirmations.push(done ? `Checked off "${match.text}".` : `Unchecked "${match.text}".`);
    }
  }
  return { updated, confirmations, explicitStatus, updatesGrew, error: null };
}

// What "act" applies to — requested 2026-09-08 after "change the due
// date on task 175" failed outright: "act" previously only ever knew
// about whichever task was physically open in the UI drawer
// (currentTask), with no way to target a task named/numbered purely in
// conversation, and no way to apply one command to several tasks at
// once ("add this to all of these").
export type ActTarget = { taskId: number | null; applyToWorkingList: boolean };

// Resolves which task(s) an "act" command applies to — pure, so the
// priority order (an explicit id wins over bulk, bulk wins over
// whatever's currently open) is unit-testable without a live classify
// call. Bulk resolves against the workingList the last filter/walk/
// briefing produced, de-duplicated, in that order; an explicit id or
// the current task each resolve to a single-item list. An id or a
// working-list entry that's no longer visible (deleted, or permissions
// changed) is silently skipped rather than surfaced as an error here —
// the caller decides what an empty result means for its response.
export function resolveActTargets(target: ActTarget, currentTask: StoredTask | null, workingList: number[], visible: StoredTask[]): StoredTask[] {
  if (target.applyToWorkingList) {
    const seen = new Set<number>();
    const result: StoredTask[] = [];
    for (const id of workingList) {
      if (seen.has(id)) continue;
      seen.add(id);
      const found = visible.find(t => t.id === id);
      if (found) result.push(found);
    }
    return result;
  }
  if (typeof target.taskId === "number") {
    const found = visible.find(t => t.id === target.taskId);
    return found ? [found] : [];
  }
  return currentTask ? [currentTask] : [];
}

export type BriefingCounts = { dueToday: StoredTask[]; overdue: StoredTask[]; dueTodayAsRecipient: StoredTask[] };

// Three deterministic buckets for "give me my morning briefing" —
// requested 2026-09-08: what's due or overdue as owner (the same "mine"
// scope every owner-based view already uses), plus what's due today
// where the actor is only the recipient/reporter, not the owner — the
// things other people are waiting on them for, a distinct concern from
// their own owned work. Deliberately excludes the coworker role: asked
// for specifically as "reporter/recipient", not every relationship.
export function computeBriefing(visible: StoredTask[], actorName: string, today: string): BriefingCounts {
  const dueToday = visible.filter(t => t.owner === actorName && t.status !== "Closed" && t.due === today);
  const overdue = visible.filter(t => t.owner === actorName && t.status !== "Closed" && t.due && t.due < today);
  const dueTodayAsRecipient = visible.filter(t => t.owner !== actorName && t.recipients.includes(actorName) && t.status !== "Closed" && t.due === today);
  return { dueToday, overdue, dueTodayAsRecipient };
}

export function describeBriefing(counts: BriefingCounts): string {
  const total = counts.overdue.length + counts.dueToday.length + counts.dueTodayAsRecipient.length;
  if (!total) return "You're all clear today — nothing due or overdue, and nothing waiting on you as a recipient either.";
  const parts = [
    counts.overdue.length ? `${counts.overdue.length} overdue` : "nothing overdue",
    `${counts.dueToday.length} due today`,
  ];
  if (counts.dueTodayAsRecipient.length) parts.push(`${counts.dueTodayAsRecipient.length} due today where you're the recipient`);
  // Ends with an explicit offer, not just a number dump — requested
  // 2026-09-08. Answering "yes" to exactly this question is what the
  // route's "next" handling now recognizes as "start walking the
  // briefing's own list" (see the system prompt) — asking the SAME
  // question every time keeps that recognition reliable.
  return `Here's your day: ${parts.join(", ")}. Want me to walk you through them one by one?`;
}

// Overdue first (most urgent), then your own due-today, then what's due
// today where you're just the recipient — what "next task" pages through
// after hearing the briefing. De-duplicated in case a task somehow
// qualifies for more than one bucket.
export function briefingWorkingList(counts: BriefingCounts): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const t of [...counts.overdue, ...counts.dueToday, ...counts.dueTodayAsRecipient]) {
    if (!seen.has(t.id)) { seen.add(t.id); ids.push(t.id); }
  }
  return ids;
}

// ---- Conversational list state (requested 2026-10-02 after a live Live-
// Voice session lost its place: "what's the first one?" was answered from
// the whole task list instead of the overdue list being walked, and
// "next" turned into a brand-new search that dropped "my"/"overdue"). The
// classifier used to see only the open task and the last few turns — never
// the list the person was actually looking at — so every follow-up was
// re-derived from scratch. This describes that list, in order, with where
// the person currently is in it, so "the first one", "the remaining
// ones", "them" and "next" resolve against it. ----

export type ActiveListInput = { label: string | null; filters: unknown; ids: number[]; currentTaskId: number | null };

// Returns "" when there is no usable list (nothing was filtered yet, or
// every id has since dropped out of what this person can see).
export function describeActiveList(input: ActiveListInput, visible: StoredTask[], max = 25): string {
  const byId = new Map(visible.map(task => [task.id, task]));
  const items = input.ids.map(id => byId.get(id)).filter((task): task is StoredTask => Boolean(task));
  if (!items.length) return "";
  const position = input.currentTaskId == null ? -1 : items.findIndex(task => task.id === input.currentTaskId);
  const lines = items.slice(0, max).map((task, i) => `${i + 1}. #${task.id} "${task.subject.slice(0, 90)}" — owner ${task.owner || "none"}, due ${task.due || "no date"}, ${task.status}`);
  const more = items.length > max ? `\n(+${items.length - max} more after these)` : "";
  const where = position >= 0 ? `The person is currently on item ${position + 1} of ${items.length} (#${items[position].id}); ${items.length - position - 1} item${items.length - position - 1 === 1 ? "" : "s"} still to go after this one.` : "No item from this list is open on screen right now.";
  const filters = input.filters && typeof input.filters === "object" ? `\nIt was produced by exactly these filters: ${JSON.stringify(input.filters)}` : "";
  return `THE LIST CURRENTLY ON THE PERSON'S SCREEN${input.label ? ` is "${input.label}"` : ""} — ${items.length} task${items.length === 1 ? "" : "s"}, in this order:\n${lines.join("\n")}${more}\n${where}${filters}`;
}

// Pure, DB-free logic for the voice assistant's classify-and-act
// pipeline — split out of app/api/voice-query/route.ts the same way
// every other piece of business logic this session was (task-merge.ts,
// sales-ai-mapping.ts, task-activity.ts). Matters more here than usual:
// the actual classification step needs a live OPENAI_API_KEY, which most
// dev/test environments don't have configured, so this is the only part
// of the voice assistant that can realistically be verified without one.
import type { tasks } from "../../db/schema";

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

// Shared by "walk"'s first task and wherever a task gets handed back to
// the user to act on next (standalone "next", or a chained goto_next
// inside "act") — one consistent read-out everywhere that happens.
export function describeTaskForWalk(t: StoredTask): string {
  const parts = [`${t.subject}.`];
  const description = t.description.trim();
  if (description) parts.push(/[.!?]$/.test(description) ? description : `${description}.`);
  parts.push(t.due ? `Due ${speakableDate(t.due)}.` : "No due date.");
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

// Shared by "filter" and "walk" — the exact same matching rules; only
// what happens with the result differs.
export function computeMatches(f: Filters, visible: StoredTask[], actorName: string, today: string, weekAhead: string): StoredTask[] {
  return visible.filter(t => {
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
  type: "set_due" | "set_status" | "set_priority" | "set_owner" | "set_subject" | "set_description"
      | "add_collaborator" | "remove_collaborator" | "add_recipient" | "remove_recipient"
      | "add_update" | "delete_task" | "goto_next" | null;
  dueDate: string | null; status: string | null; priority: string | null; owner: string | null;
  updateText: string | null; subjectText: string | null; descriptionText: string | null; personName: string | null;
};

export type ActionResult = {
  updated: {
    subject: string; description: string; owner: string; collaborators: string[]; recipients: string[];
    due: string; status: string; priority: string;
    updates: Array<{ text: string; at: string; by?: string }>;
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
export function applyActionSteps(current: StoredTask, steps: ActionStep[], actorName: string, knownPeople: string[]): ActionResult {
  const updated = {
    subject: current.subject, description: current.description, owner: current.owner,
    collaborators: [...current.collaborators], recipients: [...current.recipients],
    due: current.due, status: current.status, priority: current.priority,
    updates: [...current.updates],
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
      updated.owner = resolvePerson(a.owner.trim());
      confirmations.push(`Assigned it to ${updated.owner}.`);
    } else if (a.type === "set_subject") {
      if (!a.subjectText?.trim()) return fail("I didn't catch the new subject.");
      updated.subject = a.subjectText.trim().slice(0, 140);
      confirmations.push("Updated the subject.");
    } else if (a.type === "set_description") {
      if (!a.descriptionText?.trim()) return fail("I didn't catch the new description.");
      updated.description = a.descriptionText.trim();
      confirmations.push("Updated the description.");
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
      if (!a.updateText?.trim()) return fail("I didn't catch what to add as an update.");
      updated.updates.push({ text: a.updateText.trim(), at: new Date().toISOString(), by: actorName });
      updatesGrew = true;
      confirmations.push("Added the update.");
    }
  }
  return { updated, confirmations, explicitStatus, updatesGrew, error: null };
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
  return `Here's your day: ${parts.join(", ")}.`;
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

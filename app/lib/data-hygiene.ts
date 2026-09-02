import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../../db";
import { dimensionValues, sessions, taskActivity, tasks, taskViews, users } from "../../db/schema";

export type RetagType = "project" | "meeting" | "topic" | "person";
export const DIMENSION_LABEL: Record<RetagType, string> = { project: "Project", meeting: "Recurring meeting", topic: "Topic", person: "Person" };

type RetagTaskFields = { owner: string; collaborators: string[]; recipients: string[]; project: string; recurringMeeting: string; topic: string };

// Pure — given one task's current owner/collaborators/recipients/project/
// meeting/topic and a {type, from, to} retag, returns just the fields that
// need to change, or null if this task doesn't reference `from` under this
// type at all. `person` can touch up to three fields on the same task
// independently (someone who's both coworker and recipient gets both
// updated in one patch) — that's why this isn't a single find/replace.
export function retagPatch(type: RetagType, from: string, to: string, task: RetagTaskFields): Partial<RetagTaskFields> | null {
  if (!from || from === to) return null;
  const patch: Partial<RetagTaskFields> = {};
  if (type === "person") {
    if (task.owner === from) patch.owner = to;
    if (task.collaborators.includes(from)) patch.collaborators = task.collaborators.map(name => name === from ? to : name);
    if (task.recipients.includes(from)) patch.recipients = task.recipients.map(name => name === from ? to : name);
  } else if (type === "project" && task.project === from) patch.project = to;
  else if (type === "meeting" && task.recurringMeeting === from) patch.recurringMeeting = to;
  else if (type === "topic" && task.topic === from) patch.topic = to;
  return Object.keys(patch).length ? patch : null;
}

// Pure — same idea for a user's project/meeting/topic access-scope lists
// (users.projects etc.), which reference dimension values by the same
// plain string. Never applies to `person`: who a user is isn't itself a
// scope list. Deduped in case `to` is already in the list (merging into an
// existing value shouldn't produce a duplicate entry).
export function retagScopeList(type: RetagType, from: string, to: string, list: string[]): string[] | null {
  if (type === "person" || !from || from === to || !list.includes(from)) return null;
  return [...new Set(list.map(value => value === from ? to : value))];
}

const SCOPE_KEY: Partial<Record<RetagType, "projects" | "meetings" | "topics">> = { project: "projects", meeting: "meetings", topic: "topics" };

export type RetagResult = { tasksUpdated: number; usersUpdated: number };
// Renaming and merging are the same operation from the database's point of
// view: rewrite every task (and user scope list) that references `from` to
// say `to` instead, then drop the now-unused `from` suggestion. They only
// look different in the UI — rename types a brand-new `to`, merge picks an
// existing one — this function doesn't need to know which. Whole thing runs
// in one transaction: a crash partway through must never leave some tasks
// updated and others still pointing at the old value.
export async function retagDimensionValue(type: RetagType, from: string, toRaw: string, actorName: string): Promise<RetagResult> {
  const to = toRaw.trim();
  if (!to) throw new Error("New value is required");
  if (from === to) return { tasksUpdated: 0, usersUpdated: 0 };
  return getDb().transaction(async tx => {
    const allTasks = await tx.select().from(tasks);
    let tasksUpdated = 0;
    for (const task of allTasks) {
      const patch = retagPatch(type, from, to, task);
      if (!patch) continue;
      await tx.update(tasks).set(patch).where(eq(tasks.id, task.id));
      await tx.insert(taskActivity).values({ taskId: task.id, actorName, detail: `${DIMENSION_LABEL[type]} "${from}" renamed to "${to}"` });
      tasksUpdated++;
    }
    let usersUpdated = 0;
    const scopeKey = SCOPE_KEY[type];
    if (scopeKey) {
      const allUsers = await tx.select().from(users);
      for (const user of allUsers) {
        const nextList = retagScopeList(type, from, to, user[scopeKey]);
        if (!nextList) continue;
        await tx.update(users).set({ [scopeKey]: nextList }).where(eq(users.id, user.id));
        usersUpdated++;
      }
    }
    await tx.insert(dimensionValues).values({ type, value: to }).onConflictDoNothing();
    await tx.delete(dimensionValues).where(and(eq(dimensionValues.type, type), eq(dimensionValues.value, from)));
    return { tasksUpdated, usersUpdated };
  });
}

export type DimensionRow = { id: number; type: RetagType; value: string; usageCount: number; firstUsed: string | null; lastActivity: string | null; isRegisteredUser: boolean };
// One row per task field a person can appear in — owner, a coworker slot,
// or a recipient slot — counted independently, so someone who's both
// coworker and recipient on the same task contributes 2, not 1. That's a
// deliberate choice: the count is "how many places does this spelling
// appear", which is what actually matters when deciding whether a variant
// is worth cleaning up. firstUsed is the earliest task.created among those
// same references — "this spelling has been around since X" is useful
// context on its own, and directly useful side-by-side with another
// candidate's, when deciding which of two similar values is the
// longer-standing one.
function usageStats(allTasks: Array<{ owner: string; collaborators: string[]; recipients: string[]; project: string; recurringMeeting: string; topic: string; created: string }>) {
  const counts = new Map<string, number>();
  const firstUsed = new Map<string, string>();
  const bump = (type: RetagType, value: string, created: string) => {
    if (!value) return;
    const key = `${type} ${value}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    const seen = firstUsed.get(key);
    if (!seen || created < seen) firstUsed.set(key, created);
  };
  for (const task of allTasks) {
    bump("person", task.owner, task.created);
    for (const name of task.collaborators) bump("person", name, task.created);
    for (const name of task.recipients) bump("person", name, task.created);
    bump("project", task.project, task.created);
    bump("meeting", task.recurringMeeting, task.created);
    bump("topic", task.topic, task.created);
  }
  return { counts, firstUsed };
}

// "Last activity" for a person is deliberately broader than login: most
// people named on a task (a customer contact, someone from another team)
// never sign into Task AI at all, so login time alone would say nothing
// about them. Takes the most recent of: viewing a task, editing one,
// posting a status update comment, or (for a registered, currently active
// user) their last login session — whichever happened most recently, from
// any name-matched source. Good enough at this app's scale to compute in
// JS from a handful of full-table reads rather than a more elaborate SQL
// aggregation.
async function lastActivityByName(): Promise<Map<string, Date>> {
  const latest = new Map<string, Date>();
  const bump = (name: string | null, at: Date | null) => { if (!name || !at) return; const seen = latest.get(name); if (!seen || at > seen) latest.set(name, at); };
  const [views, activity, taskRows, sessionRows] = await Promise.all([
    getDb().select({ actorName: taskViews.actorName, viewedAt: taskViews.viewedAt }).from(taskViews),
    getDb().select({ actorName: taskActivity.actorName, createdAt: taskActivity.createdAt }).from(taskActivity).where(isNotNull(taskActivity.actorName)),
    getDb().select({ updates: tasks.updates }).from(tasks),
    getDb().select({ name: users.name, lastSeenAt: sessions.lastSeenAt }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(users.status, "active")),
  ]);
  for (const row of views) bump(row.actorName, row.viewedAt);
  for (const row of activity) bump(row.actorName, row.createdAt);
  for (const task of taskRows) for (const update of task.updates) if (update.by) bump(update.by, new Date(update.at));
  for (const row of sessionRows) bump(row.name, row.lastSeenAt);
  return latest;
}

// Full summary for the Data Hygiene page: every suggested value across all
// four dimensions, how many task-slots use it, and (people only) the most
// recent activity under that exact name.
export async function dimensionHygieneSummary(): Promise<DimensionRow[]> {
  const [dims, allTasks, activity, registeredNames] = await Promise.all([
    getDb().select().from(dimensionValues),
    getDb().select({ owner: tasks.owner, collaborators: tasks.collaborators, recipients: tasks.recipients, project: tasks.project, recurringMeeting: tasks.recurringMeeting, topic: tasks.topic, created: tasks.created }).from(tasks),
    lastActivityByName(),
    getDb().select({ name: users.name }).from(users),
  ]);
  const { counts, firstUsed } = usageStats(allTasks);
  const registered = new Set(registeredNames.map(row => row.name));
  return dims.map(row => {
    const type = row.type as RetagType;
    const key = `${type} ${row.value}`;
    return { id: row.id, type, value: row.value, usageCount: counts.get(key) || 0, firstUsed: firstUsed.get(key) || null, lastActivity: type === "person" ? activity.get(row.value)?.toISOString() || null : null, isRegisteredUser: type === "person" && registered.has(row.value) };
  });
}

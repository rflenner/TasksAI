// "New" task flagging — requested 2026-09-09, the "flag new tasks
// created or assigned to you in the last 72 hours which are untouched"
// piece explicitly deferred out of the original briefing request.
// Per-actor, not a property of the task itself: the same task is "new"
// for whoever it was just assigned to, and not for anyone who's already
// looked at it — see isNewFor below. Pure/DB-free logic lives here, same
// split as app/lib/voice-query.ts, for the same reason: easy to unit
// test, easy to reuse from both GET /api/tasks (the on-screen badge) and
// the voice assistant's "isNew" filter.
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { taskAssignments, taskViews } from "../../db/schema";

export const NEW_FLAG_WINDOW_MS = 72 * 60 * 60 * 1000;

// tasks.created is a free-form string — a bare YYYY-MM-DD for anything
// hand-entered (manual create, pasted minutes, dictation, Sales AI sync)
// or a full ISO timestamp for the inbound-email webhook. Noon UTC on the
// bare-date days, same convention formatCreatedDay/speakableDate already
// use elsewhere, so a date-only value doesn't drift a day off depending
// on the reader's timezone.
export function parseCreatedAt(created: string): number {
  const value = created.length > 10 ? created : `${created.slice(0, 10)}T12:00:00Z`;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

// The three conditions requested verbatim: "Open, not touched, no status
// updates" for how a task qualifies at all, "72 hours" for how long the
// flag lasts, and viewing it is what clears it early. Two independent
// reasons feed the same boolean: freshly CREATED (owner/collaborators/
// recipients are exactly as new as the task itself — no separate
// assignment record needed, see db/schema.ts's taskAssignments comment)
// or freshly ASSIGNED to an already-existing task. Either one flags it;
// a task can't be "more new" than the other, so this only ever returns
// true/false, not which reason won.
export function isTaskNewFor(
  task: { status: string; updates: unknown[]; created: string },
  now: number,
  viewedAt: number | null,
  assignedAt: number | null,
): boolean {
  if (task.status !== "Open" || task.updates.length > 0) return false;
  const createdAt = parseCreatedAt(task.created);
  if (now - createdAt <= NEW_FLAG_WINDOW_MS && (viewedAt === null || viewedAt < createdAt)) return true;
  if (assignedAt !== null && now - assignedAt <= NEW_FLAG_WINDOW_MS && (viewedAt === null || viewedAt < assignedAt)) return true;
  return false;
}

// Which names are newly present in owner/collaborators/recipients on an
// EXISTING task compared to before this edit — the trigger for writing a
// taskAssignments row. Owner is a single field (added only when it
// actually changed to someone new); collaborators/recipients use the
// same added-vs-removed diff describeChanges already computes, just
// returning the added side. De-duplicated: someone who's simultaneously
// added as, say, both owner and a recipient in one edit (unusual, but
// the fields are independent) only needs one fresh assignedAt row.
export function newlyAssignedPeople(
  before: { owner: string; collaborators: string[]; recipients: string[] },
  after: { owner: string; collaborators: string[]; recipients: string[] },
): string[] {
  const names = new Set<string>();
  if (after.owner && after.owner !== before.owner) names.add(after.owner);
  for (const name of after.collaborators) if (name && !before.collaborators.includes(name)) names.add(name);
  for (const name of after.recipients) if (name && !before.recipients.includes(name)) names.add(name);
  return [...names];
}

// Upserts one fresh assignedAt row per name — called after an edit that
// added at least one of them (see newlyAssignedPeople above). A no-op
// call (empty names) never touches the DB.
export async function noteAssignments(taskId: number, names: string[]) {
  if (!names.length) return;
  const db = getDb();
  for (const personName of names) {
    await db.insert(taskAssignments).values({ taskId, personName })
      .onConflictDoUpdate({ target: [taskAssignments.taskId, taskAssignments.personName], set: { assignedAt: new Date() } });
  }
}

// One query per lookup table, keyed by this actor only — never the
// whole taskAssignments/taskViews tables — so this stays cheap no matter
// how large the task list grows. Returned as plain millisecond maps
// (not Date) so isTaskNewFor's callers never have to think about Date
// identity/comparison quirks.
export async function loadNewFlagContext(actorName: string): Promise<{ viewedAt: Map<number, number>; assignedAt: Map<number, number> }> {
  const db = getDb();
  const [views, assignments] = await Promise.all([
    db.select().from(taskViews).where(eq(taskViews.actorName, actorName)),
    db.select().from(taskAssignments).where(eq(taskAssignments.personName, actorName)),
  ]);
  return {
    viewedAt: new Map(views.map(row => [row.taskId, row.viewedAt.getTime()])),
    assignedAt: new Map(assignments.map(row => [row.taskId, row.assignedAt.getTime()])),
  };
}

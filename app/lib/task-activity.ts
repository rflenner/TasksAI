import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { taskActivity, taskViews, type tasks } from "../../db/schema";

type StoredTask = typeof tasks.$inferSelect;

const FIELD_LABELS: Partial<Record<keyof StoredTask, string>> = {
  subject: "subject",
  description: "description",
  owner: "owner",
  due: "due date",
  project: "project",
  recurringMeeting: "recurring meeting",
  topic: "topic",
  status: "status",
};

function diffList(before: string[], after: string[], noun: string) {
  const added = after.filter(value => !before.includes(value));
  const removed = before.filter(value => !after.includes(value));
  return [
    ...added.map(value => `added ${value} as ${noun}`),
    ...removed.map(value => `removed ${value} as ${noun}`),
  ];
}

// Compares before/after and returns one readable line per changed field —
// not a generic diff blob, so it renders directly in the Task History UI.
// Deliberately skips `updates`: that's the free-text Status Updates log,
// already shown as its own section.
export function describeChanges(before: StoredTask, after: StoredTask): string[] {
  const lines: string[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS) as [keyof StoredTask, string][]) {
    const previous = before[field], next = after[field];
    if (previous === next) continue;
    if (field === "description") { lines.push("updated the description"); continue; }
    lines.push(`changed ${label} from "${previous ?? "(none)"}" to "${next ?? "(none)"}"`);
  }
  lines.push(...diffList(before.collaborators, after.collaborators, "coworker"));
  lines.push(...diffList(before.recipients, after.recipients, "recipient"));
  return lines;
}

// A posted status update is a signal someone's actively working the
// task — bump Open -> In progress automatically, whether the note came
// from the drawer's "Post update" button (PATCH /api/tasks) or a voice
// "act" command (confirmed live 2026-09-07, applied consistently to
// both so the same action doesn't behave differently by how it was
// triggered). An explicit status choice in the same edit always wins
// over this inference, and an already-Closed or already-In-progress
// task is left alone — a note shouldn't silently reopen finished work,
// and there's nothing to bump if it's already moving.
export function autoAdvanceStatus(currentStatus: string, updatesGrew: boolean, explicitNewStatus: string | null): string {
  if (explicitNewStatus) return explicitNewStatus;
  if (updatesGrew && currentStatus === "Open") return "In progress";
  return currentStatus;
}

export async function recordActivity(taskId: number, actorName: string | null, details: string[]) {
  if (!details.length) return;
  await getDb().insert(taskActivity).values(details.map(detail => ({ taskId, actorName, detail })));
}

export async function recordView(taskId: number, actorName: string) {
  await getDb().insert(taskViews).values({ taskId, actorName }).onConflictDoUpdate({ target: [taskViews.taskId, taskViews.actorName], set: { viewedAt: new Date() } });
}

export type ActivityEntry = { type: "created" | "edit" | "view"; detail: string; actorName: string | null; at: string };

export async function taskHistory(taskId: number, created: string, createdBy: string | null): Promise<ActivityEntry[]> {
  const [activity, views] = await Promise.all([
    getDb().select().from(taskActivity).where(eq(taskActivity.taskId, taskId)),
    getDb().select().from(taskViews).where(eq(taskViews.taskId, taskId)),
  ]);
  const entries: ActivityEntry[] = [
    { type: "created", detail: "created this task", actorName: createdBy, at: new Date(`${created}T00:00:00Z`).toISOString() },
    ...activity.map(row => ({ type: "edit" as const, detail: row.detail, actorName: row.actorName, at: row.createdAt.toISOString() })),
    ...views.map(row => ({ type: "view" as const, detail: "viewed this task", actorName: row.actorName, at: row.viewedAt.toISOString() })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

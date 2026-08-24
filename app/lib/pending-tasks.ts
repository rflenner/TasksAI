import { getDb } from "../../db";
import { tasks } from "../../db/schema";
import type { PendingTaskLine } from "./email";
import type { Role } from "./permissions";

export type TargetUser = { id: number; name: string; role: Role };
export type TaskDigest = {
  myTasks: PendingTaskLine[];
  delegatedTasks: PendingTaskLine[];
  recentlyClosed: PendingTaskLine[];
};
export type TaskBucket = "myTasks" | "delegatedTasks" | "recentlyClosed" | null;
type ClassifiableTask = { owner: string; collaborators: string[]; recipients: string[]; status: string; closedAt: Date | null };

// Sorts a single task into exactly one digest bucket for a given viewer, or
// null if it doesn't belong in their digest at all. Pure and DB-free so the
// precedence rules are unit-tested directly, no database required:
// - readonly actors are only ever "recipient", even if the data happens to
//   also list them as owner/collaborator — same restriction relationship()
//   applies everywhere else in the app.
// - owner/coworker beats a recipient-only relationship: someone who is both
//   only ever lands in myTasks, never doubled up into delegatedTasks too.
// - a closed task needs both the right relationship AND a closedAt inside
//   the lookback window — closed-but-too-old, or closed-with-no-closedAt
//   (closed before this feature shipped), is excluded rather than shown
//   with a blank date.
export function classifyForDigest(task: ClassifiableTask, actor: { name: string; role: Role }, closedSince: Date): TaskBucket {
  const isOwnerOrCoworker = actor.role !== "readonly" && (task.owner === actor.name || task.collaborators.includes(actor.name));
  const isRecipient = task.recipients.includes(actor.name);
  if (task.status === "Closed") {
    if (!task.closedAt || task.closedAt < closedSince) return null;
    return isOwnerOrCoworker || isRecipient ? "recentlyClosed" : null;
  }
  if (isOwnerOrCoworker) return "myTasks";
  if (isRecipient) return "delegatedTasks";
  return null;
}

type RawTask = { subject: string; description: string; project: string; topic: string; recurringMeeting: string; due: string; status: string; owner: string; collaborators: string[]; recipients: string[]; closedAt: Date | null };

// Maps a raw task row to the shape the pending-tasks/invitation email
// templates render, from the perspective of `name` (owner/coworker/
// recipient — whichever applies). Shared by personalTaskDigest and the
// external-invite task preview so both compute "role" and "overdue" the
// same way.
export function taskLineFor(task: RawTask, name: string, today = new Date().toISOString().slice(0, 10)): PendingTaskLine {
  const role = (task.owner === name ? "Owner" : task.collaborators.includes(name) ? "Coworker" : task.recipients.includes(name) ? "Recipient" : undefined) as "Owner" | "Coworker" | "Recipient" | undefined;
  return {
    subject: task.subject,
    description: task.description || undefined,
    project: task.project || undefined,
    topic: task.topic || undefined,
    meeting: task.recurringMeeting || undefined,
    due: task.due || undefined,
    overdue: Boolean(task.due) && task.due < today && task.status !== "Closed",
    status: (task.status === "Closed" ? "Closed" : task.status === "In progress" ? "In progress" : "Open") as "Open" | "In progress" | "Closed",
    role,
    closedAt: task.closedAt ? task.closedAt.toISOString().slice(0, 10) : undefined,
  };
}

// Open (never closed) tasks where `name` appears as owner, coworker, or
// recipient — a plain filter, not role-aware like classifyForDigest. Used
// both for the "N tasks reference this name" preview when composing an
// invitation and for the task preview baked into the invitation email
// itself. The caller is responsible for any visibility scoping first (e.g.
// an inviting admin should only ever see/send tasks they themselves can
// see — see app/api/tasks/match-name/route.ts), since this function has no
// concept of who's asking.
export function tasksReferencingName<T extends { owner: string; collaborators: string[]; recipients: string[]; status: string }>(all: T[], name: string): T[] {
  return all.filter(task => task.status !== "Closed" && (task.owner === name || task.collaborators.includes(name) || task.recipients.includes(name)));
}

// Splits a person's personally-relevant tasks into three buckets for the
// pending-tasks digest — same rule for every role, including admins: this is
// about what's personally on their plate, not the broader "everything my
// role can see" (canSeeTask). See classifyForDigest for the exact rules.
export async function personalTaskDigest(target: TargetUser, closedWithinHours = 24): Promise<TaskDigest> {
  const all = await getDb().select().from(tasks);
  const today = new Date().toISOString().slice(0, 10);
  const closedSince = new Date(Date.now() - closedWithinHours * 3600000);
  const digest: TaskDigest = { myTasks: [], delegatedTasks: [], recentlyClosed: [] };
  for (const task of all) {
    const bucket = classifyForDigest(task, target, closedSince);
    if (bucket) digest[bucket].push(taskLineFor(task, target.name, today));
  }
  digest.myTasks.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  digest.delegatedTasks.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  digest.recentlyClosed.sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
  return digest;
}

// End of the current ISO week (the coming Sunday), as an ISO date string.
export function endOfThisWeek(today = new Date()): string {
  const isoDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + (7 - isoDay));
  return end.toISOString().slice(0, 10);
}

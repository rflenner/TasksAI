import { getDb } from "../../db";
import { tasks } from "../../db/schema";
import type { PendingTaskLine } from "./email";
import { relationship } from "./permissions";
import type { Role } from "./permissions";

export type TargetUser = { id: number; name: string; role: Role };

// Tasks where the user is personally the owner, a coworker, or a recipient —
// same rule for every role, including admins. Not the broader "everything my
// role can see" (canSeeTask): a reminder is about what's on your own plate.
export async function personalPendingTasks(target: TargetUser): Promise<{ tasks: PendingTaskLine[]; total: number }> {
  const all = await getDb().select().from(tasks);
  const today = new Date().toISOString().slice(0, 10);
  const actorLike = { name: target.name, role: target.role, email: "", status: "active", projects: [], meetings: [], topics: [] };
  const list: PendingTaskLine[] = all
    .filter(task => task.status !== "Closed" && relationship(task, actorLike))
    .map(task => ({
      subject: task.subject,
      description: task.description || undefined,
      project: task.project || undefined,
      meeting: task.recurringMeeting || undefined,
      due: task.due || undefined,
      overdue: Boolean(task.due) && task.due < today,
      status: (task.status === "In progress" ? "In progress" : "Open") as "Open" | "In progress",
      role: (task.owner === target.name ? "Owner" : task.collaborators.includes(target.name) ? "Coworker" : task.recipients.includes(target.name) ? "Recipient" : undefined) as "Owner" | "Coworker" | "Recipient" | undefined,
    }))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  return { tasks: list, total: list.length };
}

// End of the current ISO week (the coming Sunday), as an ISO date string.
export function endOfThisWeek(today = new Date()): string {
  const isoDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + (7 - isoDay));
  return end.toISOString().slice(0, 10);
}

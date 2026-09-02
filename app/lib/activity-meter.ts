import { isNotNull } from "drizzle-orm";
import { getDb } from "../../db";
import { taskActivity, tasks, taskViews } from "../../db/schema";

export type ActivityKind = "active" | "passive";
export type ActivityEvent = { name: string; at: Date; kind: ActivityKind };
export type ActivityCounts = { active: number; passive: number; score: number };
export type ActivityStats = { last30Days: ActivityCounts; allTime: ActivityCounts };

// Active work (editing a task, posting a status update, creating one)
// outweighs passive viewing 3:1 — "make a difference if people just look at
// tasks or actively work on them" was the explicit ask. Window is 30 days,
// deliberately alongside an all-time total rather than instead of it: the
// 30-day score answers "how engaged lately", the all-time count answers
// "how much history is there at all" — a brand-new hire and someone who's
// gone quiet after months of heavy use can land on the same 30-day score
// for very different reasons, and the all-time number is what tells them
// apart.
const ACTIVE_WEIGHT = 3;
const PASSIVE_WEIGHT = 1;
const WINDOW_DAYS = 30;

const blankCounts = (): ActivityCounts => ({ active: 0, passive: 0, score: 0 });

// Pure — takes a flat list of {name, at, kind} events (already resolved
// from whatever tables they came from) and folds them into per-name
// windowed + all-time counts. Kept separate from the DB read so the
// scoring/windowing logic is directly testable without a database, same
// pattern as retagPatch in data-hygiene.ts.
export function summarizeActivity(events: ActivityEvent[], now: Date = new Date()): Map<string, ActivityStats> {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  const stats = new Map<string, ActivityStats>();
  for (const event of events) {
    if (!event.name) continue;
    const row = stats.get(event.name) ?? { last30Days: blankCounts(), allTime: blankCounts() };
    const weight = event.kind === "active" ? ACTIVE_WEIGHT : PASSIVE_WEIGHT;
    row.allTime[event.kind]++;
    row.allTime.score += weight;
    if (event.at >= windowStart && event.at <= now) {
      row.last30Days[event.kind]++;
      row.last30Days.score += weight;
    }
    stats.set(event.name, row);
  }
  return stats;
}

// Same four sources as data-hygiene.ts's lastActivityByName, reshaped into
// flat events instead of a single max timestamp — viewing a task is
// passive, everything else (editing a field, posting a status update,
// creating the task in the first place) is active.
async function collectActivityEvents(): Promise<ActivityEvent[]> {
  const [views, activity, taskRows] = await Promise.all([
    getDb().select({ actorName: taskViews.actorName, viewedAt: taskViews.viewedAt }).from(taskViews),
    getDb().select({ actorName: taskActivity.actorName, createdAt: taskActivity.createdAt }).from(taskActivity).where(isNotNull(taskActivity.actorName)),
    getDb().select({ updates: tasks.updates, createdBy: tasks.createdBy, created: tasks.created }).from(tasks),
  ]);
  const events: ActivityEvent[] = [];
  for (const row of views) if (row.actorName) events.push({ name: row.actorName, at: row.viewedAt, kind: "passive" });
  for (const row of activity) if (row.actorName) events.push({ name: row.actorName, at: row.createdAt, kind: "active" });
  for (const task of taskRows) {
    for (const update of task.updates) if (update.by) events.push({ name: update.by, at: new Date(update.at), kind: "active" });
    if (task.createdBy) events.push({ name: task.createdBy, at: new Date(task.created), kind: "active" });
  }
  return events;
}

export async function activityStatsByName(): Promise<Map<string, ActivityStats>> {
  return summarizeActivity(await collectActivityEvents());
}

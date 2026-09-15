// One-time cleanup for tasks created before app/lib/task-defaults.ts's
// resolveDueDate existed (see PR #128) — every task still sitting on
// due:"" gets a real deadline: 7 calendar days from TODAY, the day this
// actually runs, not from each task's own (possibly long-past) created
// date. Deliberately NOT the same defaultDueDate(created, 7) the app
// itself now applies going forward: for anything created more than a
// week ago, created+7 would already be in the past — immediately
// overdue again, defeating the entire point of this cleanup. "Due in 7
// days from today" is what Rizan actually asked for and what clears the
// noise for real.
//
// Idempotent and safe to re-run: only ever touches rows where due is
// still exactly "" — a task already given a real date (by this script,
// by a person, or by any other path) is never touched again.
import { eq } from "drizzle-orm";
import { getDb, getSql } from "../db";
import { tasks } from "../db/schema";

const due = new Date();
due.setUTCDate(due.getUTCDate() + 7);
const dueDate = due.toISOString().slice(0, 10);

const updated = await getDb().update(tasks).set({ due: dueDate }).where(eq(tasks.due, "")).returning({ id: tasks.id, subject: tasks.subject });

console.log(`Set due=${dueDate} on ${updated.length} task(s) that had a blank due date:`);
for (const task of updated) console.log(`  #${task.id} ${task.subject}`);

await getSql().end();

import { eq } from "drizzle-orm";
import { renderPendingTasksEmail, sendWithResend } from "../app/lib/email";
import { endOfThisWeek, personalPendingTasks } from "../app/lib/pending-tasks";
import { getDb, getSql } from "../db";
import { users } from "../db/schema";

// Runs once daily as a Render Cron Job (see render.yaml). Sends each active
// user their personal open tasks due this week or earlier — never a future
// week, and never a user with nothing due, so this stays a short, relevant
// nudge rather than noise.
const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error("APP_URL is required");
const weekEnd = endOfThisWeek();

// TEST_EMAIL restricts a manually-triggered run to one address instead of
// every active user — set it temporarily on the Cron Job's Environment tab
// before clicking Trigger Run, then remove it so the real 05:00 UTC run goes
// out to everyone again.
const testEmail = process.env.TEST_EMAIL?.trim().toLowerCase();
if (testEmail) console.log(`TEST MODE: restricting this run to ${testEmail}`);

let active = await getDb().select().from(users).where(eq(users.status, "active"));
if (testEmail) active = active.filter(user => user.email.toLowerCase() === testEmail);
let sent = 0, skipped = 0, failed = 0;

for (const user of active) {
  try {
    const { tasks } = await personalPendingTasks(user);
    const due = tasks.filter(task => (task.due || "") <= weekEnd);
    if (!due.length) { skipped++; continue; }
    const message = renderPendingTasksEmail({ firstName: user.name, appUrl, tasks: due.slice(0, 10), totalPending: due.length });
    const delivery = await sendWithResend({ ...message, to: user.email, idempotencyKey: `daily-${user.id}-${new Date().toISOString().slice(0, 10)}` });
    if (delivery.sent) { sent++; console.log(`Sent ${user.email}: ${due.length} due this week or earlier`); }
    else { skipped++; console.log(`Skipped ${user.email}: ${delivery.reason}`); }
  } catch (error) {
    failed++;
    console.error(`Failed to notify ${user.email}:`, error instanceof Error ? error.message : error);
  }
}

console.log(`Daily reminders done: ${sent} sent, ${skipped} skipped, ${failed} failed (of ${active.length} active users)`);
await getSql().end();
if (failed) process.exitCode = 1;

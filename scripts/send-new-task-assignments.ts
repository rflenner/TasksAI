import { eq } from "drizzle-orm";
import { renderNewTasksEmail, sendWithResend } from "../app/lib/email";
import { newlyAssignedTasks } from "../app/lib/pending-tasks";
import { getDb, getSql } from "../db";
import { users } from "../db/schema";

// Runs once a day (see render.yaml) as a Render Cron Job. Separate from the
// weekly digest (send-weekly-reminders.ts) and the overdue nudge (send-
// overdue-nudges.ts): this is about noticing you were just put on a task —
// as owner, coworker, or recipient — while it's fresh, not resurfacing
// something that's already been sitting on your plate.
//
// A 26-hour lookback, not a flat 24, gives this daily run some slack
// against its own schedule drift: a task added right at yesterday's cutoff
// still gets caught if today's run fires a little late. The 2-hour overlap
// means a task landing in that sliver could in theory show up twice across
// two runs — a much smaller risk than one never showing up at all.
const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error("APP_URL is required");

// TEST_EMAIL restricts a manually-triggered run to one address instead of
// every active user — set it temporarily on the Cron Job's Environment tab
// before clicking Trigger Run, then remove it so the real run goes out to
// everyone again.
const testEmail = process.env.TEST_EMAIL?.trim().toLowerCase();
if (testEmail) console.log(`TEST MODE: restricting this run to ${testEmail}`);

let active = await getDb().select().from(users).where(eq(users.status, "active"));
if (testEmail) active = active.filter(user => user.email.toLowerCase() === testEmail);
let sent = 0, skipped = 0, failed = 0;

// Scoped per user per calendar day, same reasoning as the overdue nudge's
// idempotency key: if Render ever retries a cron run, the same person
// shouldn't get double-emailed. In TEST_EMAIL mode the key includes the
// current time instead, so every manual trigger actually sends.
const dayKey = new Date().toISOString().slice(0, 10);

for (const user of active) {
  try {
    const newTasks = await newlyAssignedTasks(user, 26);
    if (!newTasks.length) { skipped++; continue; }
    const message = renderNewTasksEmail({ firstName: user.name, appUrl, newTasks });
    const idempotencyKey = testEmail ? `new-tasks-${user.id}-test-${Date.now()}` : `new-tasks-${user.id}-${dayKey}`;
    const delivery = await sendWithResend({ ...message, to: user.email, idempotencyKey });
    if (delivery.sent) { sent++; console.log(`Sent ${user.email}: ${newTasks.length} newly assigned`); }
    else { skipped++; console.log(`Skipped ${user.email}: ${delivery.reason}`); }
  } catch (error) {
    failed++;
    console.error(`Failed to notify ${user.email}:`, error instanceof Error ? error.message : error);
  }
}

console.log(`New task assignment nudges done: ${sent} sent, ${skipped} skipped, ${failed} failed (of ${active.length} active users)`);
await getSql().end();
if (failed) process.exitCode = 1;

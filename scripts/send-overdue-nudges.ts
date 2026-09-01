import { eq } from "drizzle-orm";
import { renderOverdueNudgeEmail, sendWithResend } from "../app/lib/email";
import { overdueOwnedTasks } from "../app/lib/pending-tasks";
import { getDb, getSql } from "../db";
import { users } from "../db/schema";

// Runs every 2 days (see render.yaml) as a Render Cron Job. Separate from
// the weekly digest (scripts/send-weekly-reminders.ts) on purpose: overdue
// tasks need a tighter nag cycle than "once a week", but only for whoever's
// actually accountable — the owner, not every coworker or recipient loosely
// attached to the task. Never a user with nothing overdue, so this stays a
// short, occasional nudge rather than noise.
//
// Render cron doesn't have a native "every N days" schedule — "0 5 */2 * *"
// (day-of-month step) is the closest approximation, and it's not perfectly
// exact across month boundaries (e.g. day 31 into day 1 is a 1-day gap, not
// 2). Close enough for a reminder cadence; not worth a custom scheduler for.
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

// The idempotency key is scoped per user per calendar day on purpose — if
// Render ever retries a cron run, the same person shouldn't get double-
// emailed. But that also means a second manual Trigger Run later the same
// day silently no-ops at Resend (same key = recognized duplicate, nothing
// new sent, no new line in Resend's own log either). In TEST_EMAIL mode
// that's actively unhelpful — you want every manual trigger to actually
// send — so the key includes the current time instead, unique per run.
const dayKey = new Date().toISOString().slice(0, 10);

for (const user of active) {
  try {
    const overdueTasks = await overdueOwnedTasks(user);
    if (!overdueTasks.length) { skipped++; continue; }
    const message = renderOverdueNudgeEmail({ firstName: user.name, appUrl, overdueTasks });
    const idempotencyKey = testEmail ? `overdue-${user.id}-test-${Date.now()}` : `overdue-${user.id}-${dayKey}`;
    const delivery = await sendWithResend({ ...message, to: user.email, idempotencyKey });
    if (delivery.sent) { sent++; console.log(`Sent ${user.email}: ${overdueTasks.length} overdue and owned`); }
    else { skipped++; console.log(`Skipped ${user.email}: ${delivery.reason}`); }
  } catch (error) {
    failed++;
    console.error(`Failed to notify ${user.email}:`, error instanceof Error ? error.message : error);
  }
}

console.log(`Overdue nudges done: ${sent} sent, ${skipped} skipped, ${failed} failed (of ${active.length} active users)`);
await getSql().end();
if (failed) process.exitCode = 1;

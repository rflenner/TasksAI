import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { taskUpdateTokens, tasks } from "../../db/schema";
import type { PendingTaskLine } from "./email";
import { randomToken, sha256 } from "./security";
import { recordActivity } from "./task-activity";
import { notifySlackOnTaskChange } from "./task-notify";

// How long a link in a digest email keeps working — generous on purpose:
// a weekly digest already hands out a fresh one every week regardless, so
// this mostly matters for someone who opens an older email later. Not
// indefinite, since an ever-valid link in someone's inbox forever is a
// real (if low-severity) exposure if that inbox is ever compromised. The
// same lifetime now covers a reply-address token too (createTaskReplyToken
// below) — same credential model, same reasoning for how long it should
// keep working.
export const TASK_UPDATE_TOKEN_VALID_DAYS = 30;

async function storeUpdateToken(taskId: number, recipientName: string, recipientEmail: string, token: string): Promise<string> {
  const expiresAt = new Date(Date.now() + TASK_UPDATE_TOKEN_VALID_DAYS * 86400000);
  await getDb().insert(taskUpdateTokens).values({ taskId, tokenHash: sha256(token), recipientName, recipientEmail, expiresAt });
  return token;
}

// One token per task per recipient per email send — reusable up to
// expiresAt (see db/schema.ts's taskUpdateTokens for why), not single-use.
// Called from the digest cron scripts at send time, right before the
// email that will carry the link.
export async function createTaskUpdateToken(taskId: number, recipientName: string, recipientEmail: string): Promise<string> {
  return storeUpdateToken(taskId, recipientName, recipientEmail, randomToken(32));
}

// Same credential, same table, different alphabet — this one gets
// embedded in an email *address* (reply+{token}@..., see
// app/lib/task-notify.ts's sendManualNotify and the inbound-email
// webhook), not a URL. randomToken's base64url output is fine in a URL
// (which preserves case in transit) but risky here: some intermediate
// mail relay lowercasing an address local part is a real, if
// unusual-outside-email-headers thing, and the stored hash only matches
// the *exact* string that was issued. Lowercase hex sidesteps the whole
// question — 24 bytes/48 hex characters, same order of entropy as the
// 32-byte base64url token above.
export async function createTaskReplyToken(taskId: number, recipientName: string, recipientEmail: string): Promise<string> {
  return storeUpdateToken(taskId, recipientName, recipientEmail, randomBytes(24).toString("hex"));
}

// Mints a token for every shown task line and stamps its updateUrl —
// shared by every digest cron script, so a task line only needs a taskId
// (see app/lib/pending-tasks.ts's taskLineFor) to pick up a working "Add
// an update" button, whichever email it ends up in. A line with no
// taskId (shouldn't happen for anything this app currently sends, but
// cheaper to guard than assume) is left exactly as it was — no button,
// not an error.
export async function attachUpdateLinks(lines: PendingTaskLine[], appUrl: string, recipientName: string, recipientEmail: string): Promise<PendingTaskLine[]> {
  return Promise.all(lines.map(async line => {
    if (!line.taskId) return line;
    const token = await createTaskUpdateToken(line.taskId, recipientName, recipientEmail);
    return { ...line, updateUrl: `${appUrl}/update-task?token=${token}` };
  }));
}

// Resolves a raw token from a clicked link back to the task + recipient it
// was issued for, or null if it's unknown or past expiresAt. Never throws
// on a bad token — an expired or tampered link is an everyday, expected
// case here (not an error condition), same as an expired login code.
export async function resolveTaskUpdateToken(rawToken: string) {
  const [row] = await getDb().select().from(taskUpdateTokens).where(eq(taskUpdateTokens.tokenHash, sha256(rawToken))).limit(1);
  if (!row || row.expiresAt < new Date()) return null;
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, row.taskId)).limit(1);
  if (!task) return null;
  return { task, recipientName: row.recipientName, recipientEmail: row.recipientEmail };
}

export const TASK_UPDATE_STATUSES = ["Open", "In progress", "Closed"] as const;

export type ApplyTaskUpdateResult =
  | { ok: true; task: { subject: string; status: string } }
  | { ok: false; status: 410; error: "expired" }
  | { ok: false; status: 400; error: string };

// The one place that actually applies a no-session, token-authenticated
// update to a task — originally /api/tasks/quick-update/route.ts's whole
// POST handler, extracted 2026-09-15 so the inbound-email reply path
// (app/api/webhooks/inbound-email/route.ts) can drive the exact same
// behavior a clicked "Add an update" link does: same Task History
// wording, same Slack notify, same closedAt bookkeeping. Deliberately
// takes the same three loose inputs quick-update's request body did
// (token/text/status) rather than a narrower shape, so that route can
// become a thin pass-through without reshaping anything.
export async function applyTaskUpdateViaToken(token: string, text: string | undefined, status: string | undefined): Promise<ApplyTaskUpdateResult> {
  const resolved = await resolveTaskUpdateToken(token);
  if (!resolved) return { ok: false, status: 410, error: "expired" };
  const { task, recipientName } = resolved;
  const trimmedText = String(text || "").trim();
  const newStatus = status && (TASK_UPDATE_STATUSES as readonly string[]).includes(status) ? status : task.status;
  if (!trimmedText && newStatus === task.status) return { ok: false, status: 400, error: "Add an update or change the status first" };

  const by = `${recipientName} (via email)`;
  const updates = trimmedText ? [...task.updates, { text: trimmedText, at: new Date().toISOString(), by }] : task.updates;
  // Same closedAt bookkeeping PATCH /api/tasks applies: a fresh close gets
  // a new timestamp, an already-closed task editing something else here
  // keeps its original one, reopening clears it.
  const closedAt = newStatus !== "Closed" ? null : task.status === "Closed" ? task.closedAt : new Date();
  const [updated] = await getDb().update(tasks).set({ status: newStatus, updates, closedAt }).where(eq(tasks.id, task.id)).returning();

  // actorName is free text, not a foreign key to users — attributing to
  // `by` (already suffixed "(via email)") keeps Task History reading
  // consistently with the Status Updates log either way this happened.
  const activity: string[] = [];
  if (trimmedText) activity.push(`added an update via email link`);
  if (newStatus !== task.status) activity.push(`changed status from ${task.status} to ${newStatus} via email link`);
  await recordActivity(task.id, by, activity);

  // recipientName, not `by` — namesToNotify excludes by exact match
  // against owner/collaborators/recipients, which store the clean name,
  // not the "(via email)" suffix used for the activity log.
  const justClosed = task.status !== "Closed" && newStatus === "Closed";
  if (justClosed || trimmedText) await notifySlackOnTaskChange(updated, recipientName, justClosed ? "closed" : "update");

  return { ok: true, task: { subject: updated.subject, status: updated.status } };
}

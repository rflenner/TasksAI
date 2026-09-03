import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { taskUpdateTokens, tasks } from "../../db/schema";
import type { PendingTaskLine } from "./email";
import { randomToken, sha256 } from "./security";

// How long a link in a digest email keeps working — generous on purpose:
// a weekly digest already hands out a fresh one every week regardless, so
// this mostly matters for someone who opens an older email later. Not
// indefinite, since an ever-valid link in someone's inbox forever is a
// real (if low-severity) exposure if that inbox is ever compromised.
export const TASK_UPDATE_TOKEN_VALID_DAYS = 30;

// One token per task per recipient per email send — reusable up to
// expiresAt (see db/schema.ts's taskUpdateTokens for why), not single-use.
// Called from the digest cron scripts at send time, right before the
// email that will carry the link.
export async function createTaskUpdateToken(taskId: number, recipientName: string, recipientEmail: string): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TASK_UPDATE_TOKEN_VALID_DAYS * 86400000);
  await getDb().insert(taskUpdateTokens).values({ taskId, tokenHash: sha256(token), recipientName, recipientEmail, expiresAt });
  return token;
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

import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tasks, users } from "../../../../db/schema";
import { canSeeTask } from "../../../lib/permissions";
import { resolvePrefs } from "../../../lib/notification-prefs";
import { appLinkOrigin, requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";
import { recordActivity } from "../../../lib/task-activity";
import { notifyCandidates, sendManualNotify, type NotifyChannel } from "../../../lib/task-notify";

// Who could be pinged about a task, and on what — powers the "notify"
// panel's person/channel picker before anything's actually sent. A live
// call (notifyCandidates does a Slack lookup per candidate), not
// precomputed, so "connected" always reflects Slack right now rather
// than a stale cached flag.
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const taskId = Number(new URL(request.url).searchParams.get("taskId"));
  if (!Number.isInteger(taskId)) return Response.json({ error: "taskId is required" }, { status: 400 });
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || !canSeeTask(task, actor)) return Response.json({ error: "Task not found" }, { status: 404 });
  const people = await notifyCandidates([task.owner, ...task.collaborators, ...task.recipients], actor.name);
  const [me] = actor.id ? await getDb().select({ notificationPrefs: users.notificationPrefs }).from(users).where(eq(users.id, actor.id)).limit(1) : [];
  return Response.json({ people, defaultChannel: resolvePrefs(me?.notificationPrefs).lastNotifyChannel ?? null });
}

// Sends one notification right now and, on success, both logs it to Task
// History (so "why did Shankar suddenly get a Slack DM from me" is
// answerable later) and remembers the channel as this sender's new
// default for next time.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request);
  if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json() as { taskId?: number; toEmail?: string; channel?: NotifyChannel; message?: string };
  const taskId = Number(body.taskId);
  const toEmail = String(body.toEmail || "").trim();
  const message = String(body.message || "").trim();
  const channel = body.channel;
  if (!Number.isInteger(taskId) || !toEmail || !message || (channel !== "email" && channel !== "slack")) {
    return Response.json({ error: "taskId, toEmail, channel and message are all required" }, { status: 400 });
  }
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || !canSeeTask(task, actor)) return Response.json({ error: "Task not found" }, { status: 404 });

  // Only someone already on the task, by their registered email — keeps
  // this to "notify a person connected to this task", not an open relay
  // to any address.
  const onTask = new Set([task.owner, ...task.collaborators, ...task.recipients]);
  const [recipient] = await getDb().select({ name: users.name, email: users.email }).from(users).where(eq(users.email, toEmail)).limit(1);
  if (!recipient || !onTask.has(recipient.name)) return Response.json({ error: "That person isn't on this task" }, { status: 400 });

  const result = await sendManualNotify({
    taskId: task.id, taskSubject: task.subject, fromName: actor.name,
    toEmail: recipient.email, toName: recipient.name, channel, message,
    appUrl: appLinkOrigin(request),
  });
  if (result.sent) {
    await recordActivity(taskId, actor.name, [`pinged ${recipient.name} via ${channel === "slack" ? "Slack" : "email"}: "${message}"`]);
    if (actor.id) {
      const [row] = await getDb().select({ notificationPrefs: users.notificationPrefs }).from(users).where(eq(users.id, actor.id)).limit(1);
      await getDb().update(users).set({ notificationPrefs: { ...resolvePrefs(row?.notificationPrefs), lastNotifyChannel: channel } }).where(eq(users.id, actor.id));
    }
  }
  return Response.json(result);
}

import { eq, inArray } from "drizzle-orm";
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
  const { people, unregistered } = await notifyCandidates([task.owner, ...task.collaborators, ...task.recipients]);
  const [me] = actor.id ? await getDb().select({ notificationPrefs: users.notificationPrefs }).from(users).where(eq(users.id, actor.id)).limit(1) : [];
  return Response.json({ people, unregistered, defaultChannel: resolvePrefs(me?.notificationPrefs).lastNotifyChannel ?? null });
}

// Sends to every selected person right now (one DM/email each, same
// message) and, per person that actually went out, logs it to Task
// History (so "why did Shankar suddenly get a Slack DM from me" is
// answerable later). Remembers the channel as this sender's new default
// once, not per recipient — added 2026-09-14 for the multi-select "PEOPLE"
// picker; a single-recipient send is just the array-of-one case.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request);
  if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json() as { taskId?: number; toEmails?: string[]; channel?: NotifyChannel; message?: string };
  const taskId = Number(body.taskId);
  const toEmails = [...new Set((Array.isArray(body.toEmails) ? body.toEmails : []).map(email => String(email || "").trim()).filter(Boolean))];
  const message = String(body.message || "").trim().slice(0, 1000);
  const channel = body.channel;
  if (!Number.isInteger(taskId) || !toEmails.length || !message || (channel !== "email" && channel !== "slack")) {
    return Response.json({ error: "taskId, at least one recipient, a channel and a message are all required" }, { status: 400 });
  }
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || !canSeeTask(task, actor)) return Response.json({ error: "Task not found" }, { status: 404 });

  // Only people already on the task, by their registered email — keeps
  // this to "notify people connected to this task", not an open relay to
  // any address.
  const onTask = new Set([task.owner, ...task.collaborators, ...task.recipients]);
  const candidates = await getDb().select({ name: users.name, email: users.email }).from(users).where(inArray(users.email, toEmails));
  const recipients = candidates.filter(person => onTask.has(person.name));
  if (!recipients.length) return Response.json({ error: "None of the selected people are on this task" }, { status: 400 });

  const appUrl = appLinkOrigin(request);
  const results = await Promise.all(recipients.map(async recipient => {
    const result = await sendManualNotify({
      task: { id: task.id, subject: task.subject, description: task.description, due: task.due || null, status: task.status, project: task.project, topic: task.topic, recurringMeeting: task.recurringMeeting },
      fromName: actor.name, toEmail: recipient.email, toName: recipient.name, channel, message, appUrl,
    });
    return { name: recipient.name, email: recipient.email, sent: result.sent, reason: result.reason };
  }));

  const sentTo = results.filter(result => result.sent);
  if (sentTo.length) {
    await recordActivity(taskId, actor.name, sentTo.map(result => `pinged ${result.name} via ${channel === "slack" ? "Slack" : "email"}: "${message}"`));
    if (actor.id) {
      const [row] = await getDb().select({ notificationPrefs: users.notificationPrefs }).from(users).where(eq(users.id, actor.id)).limit(1);
      await getDb().update(users).set({ notificationPrefs: { ...resolvePrefs(row?.notificationPrefs), lastNotifyChannel: channel } }).where(eq(users.id, actor.id));
    }
  }
  return Response.json({ results, sent: sentTo.length > 0, sentCount: sentTo.length, totalCount: recipients.length });
}

// Real-time Slack notification when a task gets a status update or is
// closed — the direct answer to "how could we notify on tasks" from the
// Slack integration work: instead of waiting for the next digest email,
// whoever's on the task (owner, coworkers, recipients) other than whoever
// just made the change hears about it in Slack immediately. First of the
// three notification pieces (real-time DM, digests-in-Slack, per-user
// preferences), agreed 2026-09-11 as the one worth building first — it's
// the one nothing else (the existing email crons) already does.
//
// Best-effort throughout: a Slack failure (no bot token configured, no
// Slack account at that email, a transient API error) never blocks or
// fails the task write that triggered it, and never surfaces to the
// person who made the change — same "each recipient is independent, log
// and move on" shape the email crons already use.
import { inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { users } from "../../db/schema";
import { renderManualNotifyEmail, sendWithResend } from "./email";
import { resolvePrefs } from "./notification-prefs";
import { buildDigestBlocks, buildTaskCardBlocks, type DigestLine, lookupSlackUserByEmail, openDirectMessage, postMessage } from "./slack";
import { createTaskReplyToken } from "./task-update-tokens";

// Domain the inbound webhook is actually wired to receive at (see the
// "Forwarding an email to tasks@..." comment atop
// app/api/webhooks/inbound-email/route.ts) — deliberately NOT
// TASK_AI_FROM_EMAIL's domain (tasks.flenner.at by default): outbound
// sending and inbound receiving are two different Resend-configured
// domains in this app, and a reply-to address only works if it's on the
// one Resend actually routes inbound mail for.
const INBOUND_EMAIL_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || "tasks.iseeit.ai";

type NotifiableTask = { id: number; subject: string; description: string; status: string; due: string | null; owner: string; collaborators: string[]; recipients: string[] };

// Everyone connected to the task except whoever just changed it. Owner,
// collaborators and recipients all get notified — unlike the "New status
// update" badge/filter which is about what a given VIEWER hasn't seen
// yet, an update matters to everyone on the task, not only recipients.
export function namesToNotify(task: { owner: string; collaborators: string[]; recipients: string[] }, actorName: string | null): string[] {
  const names = new Set<string>();
  if (task.owner) names.add(task.owner);
  for (const name of task.collaborators) if (name) names.add(name);
  for (const name of task.recipients) if (name) names.add(name);
  if (actorName) names.delete(actorName);
  return [...names];
}

export async function notifySlackOnTaskChange(task: NotifiableTask, actorName: string | null, trigger: "update" | "closed"): Promise<void> {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return; // Slack isn't configured (e.g. local dev) — silently skip, not an error.
    const names = namesToNotify(task, actorName);
    if (!names.length) return;
    const candidates = await getDb().select({ email: users.email, name: users.name, notificationPrefs: users.notificationPrefs }).from(users).where(inArray(users.name, names));
    const recipients = candidates.filter(person => resolvePrefs(person.notificationPrefs).statusUpdateSlack);
    if (!recipients.length) return;

    const lead = trigger === "closed"
      ? `✅ *#${task.id} ${task.subject}* was just closed${actorName ? ` by ${actorName}` : ""}.`
      : `📝 New update on *#${task.id} ${task.subject}*${actorName ? ` from ${actorName}` : ""}.`;
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: lead } }, ...buildTaskCardBlocks(task)];
    const plainText = lead.replace(/\*/g, "");

    await Promise.all(recipients.map(async person => {
      try {
        const slackUserId = await lookupSlackUserByEmail(token, person.email);
        if (!slackUserId) return; // no Slack account at that address — normal, not a failure.
        const channel = await openDirectMessage(token, slackUserId);
        if (!channel) return;
        await postMessage(token, { channel, text: plainText, blocks });
      } catch (error) {
        console.error(`Slack notify failed for ${person.email}:`, error instanceof Error ? error.message : error);
      }
    }));
  } catch (error) {
    console.error("Slack notify failed:", error instanceof Error ? error.message : error);
  }
}

// The Slack counterpart to the 3 email-cron digests — same idea as
// notifySlackOnTaskChange (best-effort, one DM, never throws to the
// caller) but for a whole digest's worth of lines at once, grouped into
// sections, rather than one task's change. Returns {sent, reason} the
// same shape sendWithResend already does, so a cron script can log both
// channels' outcomes the same way.
export async function sendSlackDigest(user: { name: string; email: string }, intro: string, sections: Array<{ heading?: string; lines: DigestLine[] }>): Promise<{ sent: boolean; reason?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { sent: false, reason: "Slack is not configured" };
  try {
    const slackUserId = await lookupSlackUserByEmail(token, user.email);
    if (!slackUserId) return { sent: false, reason: "no Slack account at this address" };
    const channel = await openDirectMessage(token, slackUserId);
    if (!channel) return { sent: false, reason: "could not open a Slack DM" };
    await postMessage(token, { channel, text: intro.replace(/[*_~`]/g, ""), blocks: buildDigestBlocks(intro, sections) });
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Slack digest failed for ${user.email}:`, reason);
    return { sent: false, reason };
  }
}

// The "notify someone right now" button on a task — the direct answer to
// Rizan's "I would like to manually notify a owner or co-worker on a
// specific task ... to give me an update" (2026-09-14). Deliberately not
// routed through namesToNotify/notifySlackOnTaskChange above: those are
// automatic, best-effort, and fan out to everyone on the task; this is a
// single, explicit, person-picked send, and a failure has to be reported
// back to whoever clicked Send rather than only logged.
export type NotifyChannel = "email" | "slack";
export type NotifyCandidate = { name: string; email: string; channels: NotifyChannel[] };

export type NotifyCandidates = { people: NotifyCandidate[]; unregistered: string[] };

// Who could be notified about this task — its owner, coworkers and
// recipients. Used to exclude the actor themself here; dropped that
// 2026-09-15 ("I might want to send it even to myself!") — a self-DM/
// self-email is a completely ordinary send, no reason to special-case
// it out. Split into people (registered users, restricted to who's
// actually reachable — an unregistered plain-text name has no email to
// send to at all) and unregistered (task-connected names with no
// matching account), so the picker can explain *why* someone's missing
// instead of just silently not listing them — see unregisteredNames/
// invite-strip in TaskApp.js for the same "not yet invited" concept,
// reused here rather than reinvented. Channel availability is per
// person: email whenever they have one on file (always, for a
// registered user), Slack only if a live users.lookupByEmail resolves
// for their address — same check notifySlackOnTaskChange already
// relies on, so "connected" here means exactly what it means
// everywhere else in this app.
export async function notifyCandidates(names: string[]): Promise<NotifyCandidates> {
  const wanted = [...new Set(names.filter(Boolean))];
  if (!wanted.length) return { people: [], unregistered: [] };
  const rows = await getDb().select({ email: users.email, name: users.name }).from(users).where(inArray(users.name, wanted));
  const registeredNames = new Set(rows.map(row => row.name));
  const unregistered = wanted.filter(name => !registeredNames.has(name));
  const token = process.env.SLACK_BOT_TOKEN;
  const people = await Promise.all(rows.map(async person => {
    const channels: NotifyChannel[] = ["email"];
    if (token) {
      try { if (await lookupSlackUserByEmail(token, person.email)) channels.push("slack"); }
      catch { /* Slack lookup failed — email is still offered, not a hard failure */ }
    }
    return { name: person.name, email: person.email, channels };
  }));
  return { people, unregistered };
}

// Fires one message right now, on the channel the sender picked — email
// via the same sendWithResend every other email in this app uses, Slack
// via the same DM plumbing as the automatic notifications, just with a
// short free-text note instead of the full task card.
export type ManualNotifyTask = {
  id: number; subject: string; description: string; due: string | null; status: string;
  project?: string; topic?: string; recurringMeeting?: string;
};
export async function sendManualNotify(input: {
  task: ManualNotifyTask; fromName: string;
  toEmail: string; toName: string; channel: NotifyChannel; message: string; appUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (input.channel === "slack") {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return { sent: false, reason: "Slack is not configured" };
    try {
      const slackUserId = await lookupSlackUserByEmail(token, input.toEmail);
      if (!slackUserId) return { sent: false, reason: "no Slack account at this address" };
      const channel = await openDirectMessage(token, slackUserId);
      if (!channel) return { sent: false, reason: "could not open a Slack DM" };
      const lead = `👋 *${input.fromName}* on *#${input.task.id} ${input.task.subject}*:`;
      const blocks = [
        { type: "section", text: { type: "mrkdwn", text: lead } },
        { type: "section", text: { type: "mrkdwn", text: input.message } },
        { type: "context", elements: [{ type: "mrkdwn", text: `<${input.appUrl}|Open in Task AI>` }] },
      ];
      await postMessage(token, { channel, text: `${input.fromName} on #${input.task.id} ${input.task.subject}: ${input.message}`, blocks });
      return { sent: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Manual Slack notify failed for ${input.toEmail}:`, reason);
      return { sent: false, reason };
    }
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { subject, html, text } = renderManualNotifyEmail({
      toFirstName: input.toName.split(" ")[0] || input.toName,
      fromName: input.fromName, message: input.message, appUrl: input.appUrl,
      task: {
        subject: input.task.subject, description: input.task.description, due: input.task.due || undefined,
        status: input.task.status as "Open" | "In progress" | "Closed", overdue: Boolean(input.task.due && input.task.due < today && input.task.status !== "Closed"),
        project: input.task.project, topic: input.task.topic, meeting: input.task.recurringMeeting, taskId: input.task.id,
      },
    });
    // A reply lands back on this exact task, no sign-in needed — same
    // token credential the "Add an update" digest links use (see
    // app/lib/task-update-tokens.ts's createTaskReplyToken), just carried
    // in the reply address instead of a clicked link. Piloting this on
    // manual notify only (2026-09-15) — the recurring digest crons still
    // send with no reply-to for now.
    const replyToken = await createTaskReplyToken(input.task.id, input.toName, input.toEmail);
    const replyTo = `reply+${replyToken}@${INBOUND_EMAIL_DOMAIN}`;
    const result = await sendWithResend({ to: input.toEmail, subject, html, text, replyTo });
    return result.sent ? { sent: true } : { sent: false, reason: result.reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Manual email notify failed for ${input.toEmail}:`, reason);
    return { sent: false, reason };
  }
}

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
import { buildTaskCardBlocks, lookupSlackUserByEmail, openDirectMessage, postMessage } from "./slack";

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
    const recipients = await getDb().select({ email: users.email, name: users.name }).from(users).where(inArray(users.name, names));
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

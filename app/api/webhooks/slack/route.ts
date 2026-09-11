// Receives everything from Task AI's Slack app: the /task slash command
// and every interactive action (button clicks, modal submissions) — Slack
// is configured to point BOTH at this one URL (see the app's manifest in
// its Slack settings), so this just branches on which shape arrived.
//
// Identity, everywhere below: a Slack user id only ever becomes a real
// Task AI actor by looking up their Slack profile email (users.info) and
// matching it against an active users row — the exact same rule
// app/api/webhooks/inbound-email/route.ts already applies to a forwarded
// email's sender. Every write additionally runs through canWriteTask —
// nothing is possible from Slack that wasn't already possible for that
// same person in the web UI.
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tasks, users } from "../../../../db/schema";
import { type Actor, canWriteTask } from "../../../lib/permissions";
import {
  buildTaskCardBlocks, buildUpdateModal, getSlackUserEmail, openView, respondToInteraction,
} from "../../../lib/slack";
import { isFreshSlackTimestamp, verifySlackSignature } from "../../../lib/slack-webhook";
import { autoAdvanceStatus, describeChanges, recordActivity } from "../../../lib/task-activity";

async function resolveActor(slackUserId: string | undefined, token: string): Promise<(Actor & { id: number }) | null> {
  if (!slackUserId) return null;
  const email = await getSlackUserEmail(token, slackUserId);
  if (!email) return null;
  const [row] = await getDb().select().from(users).where(and(eq(users.email, email), eq(users.status, "active"))).limit(1);
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, canInvite: row.canInvite, projects: row.projects, meetings: row.meetings, topics: row.topics, status: row.status };
}

// Cap well short of Slack's own per-message block limit (50) — 3 blocks
// per task card, so 10 tasks is 30 blocks, comfortably clear.
const MAX_CARDS = 10;

export async function POST(request: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) { console.error("SLACK_SIGNING_SECRET is not configured; ignoring inbound Slack request"); return Response.json({ ok: true }); }

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signatureHeader = request.headers.get("x-slack-signature");
  const body = await request.text();
  if (!timestamp || !signatureHeader || !isFreshSlackTimestamp(timestamp) || !verifySlackSignature({ secret, timestamp, body, signatureHeader })) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const form = new URLSearchParams(body);

  // Interactivity: button clicks and modal ("view") submissions — the
  // real payload arrives as one JSON string under the "payload" key.
  const payloadRaw = form.get("payload");
  if (payloadRaw) {
    if (!token) return Response.json({ ok: true });
    let payload: {
      type?: string; trigger_id?: string; response_url?: string;
      user?: { id?: string }; actions?: Array<{ action_id?: string; value?: string }>;
      view?: { callback_id?: string; private_metadata?: string; state?: { values?: Record<string, Record<string, { value?: string }>> } };
    };
    try { payload = JSON.parse(payloadRaw); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }

    if (payload.type === "block_actions") {
      const action = payload.actions?.[0];
      const taskId = Number(action?.value);
      const actor = await resolveActor(payload.user?.id, token);
      if (!Number.isInteger(taskId) || !actor) return Response.json({ ok: true });
      const [existing] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!existing || !canWriteTask(existing, actor)) {
        if (payload.response_url) await respondToInteraction(payload.response_url, { text: "You don't have permission to change that task." });
        return Response.json({ ok: true });
      }
      if (action?.action_id === "task_close") {
        const closedAt = existing.status === "Closed" ? existing.closedAt : new Date();
        const [updated] = await getDb().update(tasks).set({ status: "Closed", closedAt }).where(eq(tasks.id, taskId)).returning();
        await recordActivity(updated.id, actor.name, describeChanges(existing, updated));
        if (payload.response_url) await respondToInteraction(payload.response_url, { text: `✅ Closed by ${actor.name}`, blocks: buildTaskCardBlocks(updated) });
      } else if (action?.action_id === "task_update" && payload.trigger_id && payload.response_url) {
        await openView(token, payload.trigger_id, buildUpdateModal(taskId, existing.subject, payload.response_url));
      }
      return Response.json({ ok: true });
    }

    if (payload.type === "view_submission" && payload.view?.callback_id === "task_update_submit") {
      let meta: { taskId?: number; responseUrl?: string } = {};
      try { meta = JSON.parse(payload.view.private_metadata || "{}"); } catch { /* leave meta empty — handled below */ }
      const text = payload.view.state?.values?.update_block?.update_text?.value?.trim();
      const actor = await resolveActor(payload.user?.id, token);
      if (actor && text && Number.isInteger(meta.taskId)) {
        const [existing] = await getDb().select().from(tasks).where(eq(tasks.id, meta.taskId as number)).limit(1);
        if (existing && canWriteTask(existing, actor)) {
          // Same auto-advance rule as PATCH /api/tasks' own "Post update"
          // path: a note bumps Open -> In progress unless a status change
          // was also explicit — nothing here ever sets one explicitly, so
          // this always behaves like the plain "grew updates" case.
          const updates = [...existing.updates, { text, at: new Date().toISOString(), by: actor.name }];
          const finalStatus = autoAdvanceStatus(existing.status, true, null);
          const closedAt = finalStatus !== "Closed" ? null : existing.status === "Closed" ? existing.closedAt : new Date();
          const [updated] = await getDb().update(tasks).set({ updates, status: finalStatus, closedAt }).where(eq(tasks.id, meta.taskId as number)).returning();
          await recordActivity(updated.id, actor.name, [`posted an update: "${text.slice(0, 140)}"`]);
          if (meta.responseUrl) await respondToInteraction(meta.responseUrl, { text: `📝 Updated by ${actor.name}`, blocks: buildTaskCardBlocks(updated) });
        }
      }
      return Response.json({ response_action: "clear" });
    }
    return Response.json({ ok: true });
  }

  // Slash command: plain form fields, not JSON.
  const command = form.get("command");
  if (command) {
    if (!token) return Response.json({ response_type: "ephemeral", text: "Task AI's Slack integration is still being set up — check back soon!" });
    const actor = await resolveActor(form.get("user_id") || undefined, token);
    if (!actor) return Response.json({ response_type: "ephemeral", text: "I couldn't match your Slack account to a Task AI user — check that your Slack email matches your Task AI account's email." });
    const text = (form.get("text") || "").trim();
    if (text) {
      // Creating a task from free text is deferred — Update/Close first,
      // per the agreed sequencing.
      return Response.json({ response_type: "ephemeral", text: "Creating tasks from Slack is coming soon — for now, run /task with nothing typed to see your open tasks." });
    }
    const mine = await getDb().select().from(tasks).where(and(eq(tasks.owner, actor.name), ne(tasks.status, "Closed"))).limit(MAX_CARDS + 1);
    if (!mine.length) return Response.json({ response_type: "ephemeral", text: "You have no open tasks 🎉" });
    const blocks = mine.slice(0, MAX_CARDS).flatMap(t => buildTaskCardBlocks(t));
    const truncated = mine.length > MAX_CARDS ? [{ type: "context", elements: [{ type: "mrkdwn", text: `Showing the first ${MAX_CARDS} — open Task AI to see the rest.` }] }] : [];
    return Response.json({ response_type: "ephemeral", text: `Your open tasks (${mine.length})`, blocks: [...blocks, ...truncated] });
  }

  return Response.json({ ok: true });
}

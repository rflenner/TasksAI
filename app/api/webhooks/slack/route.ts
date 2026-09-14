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
import { applyChecklistSelection, checklistJustAdvanced } from "../../../lib/checklist";
import {
  buildEditTaskModal, buildTaskCardBlocks, getSlackUserEmail, MAX_CHECKLIST_ITEMS_IN_SLACK, openView, respondToInteraction,
} from "../../../lib/slack";
import { isFreshSlackTimestamp, verifySlackSignature } from "../../../lib/slack-webhook";
import { autoAdvanceStatus, describeChanges, recordActivity } from "../../../lib/task-activity";
import { newlyAssignedPeople, noteAssignments } from "../../../lib/task-flags";
import { notifySlackOnTaskChange } from "../../../lib/task-notify";

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
      user?: { id?: string };
      actions?: Array<{ action_id?: string; value?: string; block_id?: string; selected_options?: Array<{ value?: string }> }>;
      view?: {
        callback_id?: string; private_metadata?: string;
        state?: {
          values?: Record<string, Record<string, {
            value?: string; selected_date?: string | null; selected_user?: string | null;
            selected_option?: { value?: string } | null;
          }>>;
        };
      };
    };
    try { payload = JSON.parse(payloadRaw); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }

    if (payload.type === "block_actions") {
      const action = payload.actions?.[0];
      // The checklist checkboxes' task id rides on the block's block_id,
      // not any option's value — see applyChecklistSelection's own
      // comment for why: unchecking everything reports an empty
      // selected_options, leaving no value to read at all on that
      // direction of the toggle. Every other action here is a plain
      // button, which always carries the task id as its own value.
      const taskId = action?.action_id === "task_checklist_toggle"
        ? Number(action.block_id?.replace("task_checklist_", ""))
        : Number(action?.value);
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
        // Not the actor — they just saw this refreshed in place above.
        await notifySlackOnTaskChange(updated, actor.name, "closed");
      } else if (action?.action_id === "task_checklist_toggle") {
        // Slack reports the checkbox group's whole current selection, not
        // which single item just flipped — applyChecklistSelection applies
        // that reported truth directly rather than diffing, and only to
        // the ids Slack could actually show (the first
        // MAX_CHECKLIST_ITEMS_IN_SLACK — anything beyond that wasn't
        // rendered here at all, so nothing Slack reports could touch it).
        const visibleIds = existing.checklist.slice(0, MAX_CHECKLIST_ITEMS_IN_SLACK).map(item => item.id);
        const checkedIds = new Set((action.selected_options ?? []).map(o => o.value).filter((v): v is string => Boolean(v)));
        const checklist = applyChecklistSelection(existing.checklist, visibleIds, checkedIds);
        const advanced = checklistJustAdvanced(existing.checklist, checklist);
        const finalStatus = advanced ? autoAdvanceStatus(existing.status, true, null) : existing.status;
        const closedAt = finalStatus !== "Closed" ? null : existing.status === "Closed" ? existing.closedAt : new Date();
        const [updated] = await getDb().update(tasks).set({ checklist, status: finalStatus, closedAt }).where(eq(tasks.id, taskId)).returning();
        const details = existing.checklist.map(before => {
          const after = checklist.find(item => item.id === before.id);
          if (!after || after.done === before.done) return null;
          return after.done ? `checked off "${after.text.slice(0, 140)}"` : `unchecked "${after.text.slice(0, 140)}"`;
        }).filter((line): line is string => Boolean(line));
        details.push(...describeChanges(existing, updated));
        await recordActivity(updated.id, actor.name, details);
        if (payload.response_url) await respondToInteraction(payload.response_url, { text: `Checklist updated by ${actor.name}`, blocks: buildTaskCardBlocks(updated) });
        if (advanced) await notifySlackOnTaskChange(updated, actor.name, "update");
      } else if (action?.action_id === "task_edit" && payload.trigger_id && payload.response_url) {
        await openView(token, payload.trigger_id, buildEditTaskModal(existing, payload.response_url, "card"));
      } else if (action?.action_id === "task_edit_from_digest" && payload.trigger_id && payload.response_url) {
        // Same modal, but response_url belongs to the whole digest
        // message — see the view_submission handler below for why that
        // means never replace_original here.
        await openView(token, payload.trigger_id, buildEditTaskModal(existing, payload.response_url, "digest"));
      }
      return Response.json({ ok: true });
    }

    if (payload.type === "view_submission" && payload.view?.callback_id === "task_edit_submit") {
      let meta: { taskId?: number; responseUrl?: string; source?: "card" | "digest" } = {};
      try { meta = JSON.parse(payload.view.private_metadata || "{}"); } catch { /* leave meta empty — handled below */ }
      const actor = await resolveActor(payload.user?.id, token);
      if (!actor || !Number.isInteger(meta.taskId)) return Response.json({ response_action: "clear" });

      const [existing] = await getDb().select().from(tasks).where(eq(tasks.id, meta.taskId as number)).limit(1);
      if (!existing || !canWriteTask(existing, actor)) return Response.json({ response_action: "clear" });

      const values = payload.view.state?.values || {};
      const text = values.update_block?.update_text?.value?.trim() || "";
      const selectedStatus = values.status_block?.status_select?.selected_option?.value || null;
      const selectedDate = values.due_block?.due_date?.selected_date || null;
      const selectedSlackUserId = values.owner_block?.owner_select?.selected_user || null;

      // Only a status choice that actually DIFFERS from the current one
      // counts as "explicit" — Slack always reports the pre-filled value
      // back even if the person never touched the dropdown, and treating
      // that as an explicit choice would silently defeat autoAdvanceStatus's
      // own Open -> In progress bump on every plain text-only update.
      const explicitNewStatus = selectedStatus && selectedStatus !== existing.status ? selectedStatus : null;

      let newOwner: string | null = null;
      if (selectedSlackUserId) {
        const email = await getSlackUserEmail(token, selectedSlackUserId);
        const [ownerRow] = email ? await getDb().select().from(users).where(and(eq(users.email, email), eq(users.status, "active"))).limit(1) : [];
        if (!ownerRow) {
          return Response.json({
            response_action: "errors",
            errors: { owner_block: "That person doesn't have a Task AI account with a matching email — check their Slack profile email matches their Task AI account." },
          });
        }
        newOwner = ownerRow.name;
      }

      if (!text && !explicitNewStatus && !selectedDate && !newOwner) {
        return Response.json({ response_action: "errors", errors: { update_block: "Change something before saving." } });
      }

      const updates = text ? [...existing.updates, { text, at: new Date().toISOString(), by: actor.name }] : existing.updates;
      const finalStatus = autoAdvanceStatus(existing.status, Boolean(text), explicitNewStatus);
      const closedAt = finalStatus !== "Closed" ? null : existing.status === "Closed" ? existing.closedAt : new Date();
      const [updated] = await getDb().update(tasks).set({
        updates, status: finalStatus, closedAt,
        ...(selectedDate ? { due: selectedDate } : {}),
        ...(newOwner ? { owner: newOwner } : {}),
      }).where(eq(tasks.id, meta.taskId as number)).returning();

      const details = describeChanges(existing, updated);
      if (text) details.push(`posted an update: "${text.slice(0, 140)}"`);
      await recordActivity(updated.id, actor.name, details);
      await noteAssignments(updated.id, newlyAssignedPeople(existing, updated));

      const justClosed = existing.status !== "Closed" && finalStatus === "Closed";
      if (meta.responseUrl) {
        const confirmText = justClosed ? `✅ Closed by ${actor.name}` : `📝 Updated by ${actor.name}`;
        // A card's response_url belongs to just that one task's message —
        // safe to replace in place. A digest's response_url belongs to
        // the WHOLE multi-task digest message — replacing it would wipe
        // out every other task's line, so this posts a fresh confirmation
        // alongside it instead.
        await respondToInteraction(meta.responseUrl, { text: confirmText, blocks: buildTaskCardBlocks(updated), replace_original: meta.source === "card" });
      }
      // Same condition PATCH /api/tasks and the voice "act" command
      // already use: a real-time DM for a posted update or a fresh
      // close, not for a bare reassignment/due-date change alone.
      if (justClosed || text) await notifySlackOnTaskChange(updated, actor.name, justClosed ? "closed" : "update");

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

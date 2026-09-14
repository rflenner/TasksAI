// Thin wrapper around Slack's Web API — same "hand-rolled against exactly
// what's observed, no SDK" style as app/lib/sales-ai-client.ts. Every
// method POSTs form-encoded (Slack accepts either JSON or form-encoded
// for most of these; form-encoded is what users.lookupByEmail/users.info
// require, so everything here uses the one shape for consistency) and
// every response shares Slack's own {ok, error?, ...} envelope.
async function callSlackApi<T extends { ok: boolean; error?: string }>(method: string, token: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const result = await response.json() as T;
  if (!result.ok) throw new Error(`Slack ${method} failed: ${result.error || "unknown error"}`);
  return result;
}

export async function postMessage(token: string, params: { channel: string; text: string; blocks?: unknown[] }) {
  return callSlackApi<{ ok: boolean; ts?: string }>("chat.postMessage", token, {
    channel: params.channel, text: params.text, ...(params.blocks ? { blocks: JSON.stringify(params.blocks) } : {}),
  });
}

// Refreshes a message in place from an interaction — every block_actions/
// view_submission payload carries its own response_url, scoped to the one
// message that triggered it, so this needs no channel/ts bookkeeping of
// our own. replace_original:true so a stale "Update Close" button row
// doesn't linger under the new state.
export async function respondToInteraction(responseUrl: string, params: { text: string; blocks?: unknown[]; replace_original?: boolean }) {
  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_original: true, ...params }),
  });
  if (!res.ok) throw new Error(`Slack response_url POST failed: ${res.status}`);
}

export async function openView(token: string, triggerId: string, view: unknown) {
  return callSlackApi<{ ok: boolean }>("views.open", token, { trigger_id: triggerId, view: JSON.stringify(view) });
}

// Resolves a Slack user id (all an interaction payload gives you) to
// their email, so the caller can map it to a real Task AI account the
// exact same way app/api/webhooks/inbound-email/route.ts already maps a
// forwarded email's sender — one identity rule, everywhere a Slack
// action needs "which Task AI person did this."
export async function getSlackUserEmail(token: string, slackUserId: string): Promise<string | null> {
  const result = await callSlackApi<{ ok: boolean; user?: { profile?: { email?: string } } }>("users.info", token, { user: slackUserId });
  return result.user?.profile?.email?.toLowerCase() || null;
}

export async function lookupSlackUserByEmail(token: string, email: string): Promise<string | null> {
  try {
    const result = await callSlackApi<{ ok: boolean; user?: { id?: string } }>("users.lookupByEmail", token, { email });
    return result.user?.id || null;
  } catch {
    // users_not_found is Slack's own error for "no Slack account at this
    // address" — a completely normal outcome (not everyone Task AI knows
    // is in this Slack workspace), not a real failure worth surfacing.
    return null;
  }
}

// Opens (or resolves the already-open) 1:1 DM channel with a Slack user,
// so a proactive notification (see app/lib/task-notify.ts) can post the
// same way an interactive response does — chat.postMessage to a channel
// id. Needs the bot to have the im:write scope, in addition to the
// chat:write it already needs for postMessage — see render.yaml's
// SLACK_BOT_TOKEN comment.
export async function openDirectMessage(token: string, slackUserId: string): Promise<string | null> {
  const result = await callSlackApi<{ ok: boolean; channel?: { id?: string } }>("conversations.open", token, { users: slackUserId });
  return result.channel?.id || null;
}

// A single-option checkbox standing in for the web app's own "check to
// close" card control — checked means Closed, unchecked means Open,
// toggleable either way, added 2026-09-14 to replace the one-way "Close"
// button. The task id rides on the SECTION's block_id, not the option's
// value: unchecking reports an empty selected_options (nothing to read
// a value off), so block_id is the only place the id survives both
// directions — see the task_toggle_done handler in the webhook route.
function doneCheckbox(task: { id: number; status: string }) {
  const option = { text: { type: "plain_text", text: "Done" }, value: "done" };
  return { type: "checkboxes", action_id: "task_toggle_done", options: [option], ...(task.status === "Closed" ? { initial_options: [option] } : {}) };
}

// The reminder/task card — one shared builder for both the on-demand
// "/task list" command and the automatic reminder crons/real-time
// notify, so a task always looks the same in Slack regardless of what
// triggered it. Split into two sections (title, then description) so
// each gets its own accessory rather than sharing one — added
// 2026-09-14, per Rizan's design feedback: the checkbox reads better
// right beside the title it's checking off, and Edit reads better
// beside the description it edits, than both crowded onto one combined
// block the way the very first version had them.
export function buildTaskCardBlocks(task: { id: number; subject: string; description: string; status: string; due: string | null; owner: string }): unknown[] {
  const dueLine = task.due ? `Due ${task.due}` : "No due date";
  return [
    { type: "section", block_id: `task_toggle_${task.id}`, text: { type: "mrkdwn", text: `*#${task.id} ${task.subject}*` }, accessory: doneCheckbox(task) },
    {
      type: "section", block_id: `task_desc_${task.id}`, text: { type: "mrkdwn", text: task.description || "_No description_" },
      accessory: { type: "button", text: { type: "plain_text", text: "Edit" }, action_id: "task_edit", value: String(task.id) },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: `${task.status} · ${dueLine} · Owner: ${task.owner}` }] },
  ];
}

// One digest line — the same shape app/lib/email.ts's PendingTaskLine
// already carries (updateUrl included, when attachUpdateLinks has run),
// so a cron script that already built its email lines can hand them
// straight to buildDigestBlocks with no reshaping.
export type DigestLine = { taskId?: number; subject: string; due?: string; overdue?: boolean; status?: "Open" | "In progress" | "Closed"; closedAt?: string; updateUrl?: string };

function digestLineText(line: DigestLine): string {
  const label = line.updateUrl ? `<${line.updateUrl}|#${line.taskId ?? "?"} ${line.subject}>` : `#${line.taskId ?? "?"} ${line.subject}`;
  const detail = line.status === "Closed" ? `Closed${line.closedAt ? ` · ${line.closedAt}` : ""}` : line.overdue ? "Overdue" : line.due ? `Due ${line.due}` : "No due date";
  return `• ${label} — ${detail}`;
}

// Only the first this-many lines across a whole digest get an inline
// "Open" button — each one costs its own section block (one line per
// block, so its accessory attaches to just that line, not a group),
// versus 10 lines packed into a single block for the plain-text ones
// below. Same reasoning as MAX_CARDS in the webhook route: stays
// comfortably clear of Slack's 50-block-per-message cap even on a
// heavy digest, at the cost of the excess lines falling back to a
// plain (linked, but buttonless) line like before.
const MAX_ACTIONABLE_DIGEST_LINES = 10;

// The Slack counterpart to the 3 email-cron digests (new assignment,
// overdue, weekly) — a bulleted mrkdwn list per section (mirroring the
// email template's own grouping: My tasks / Delegated / Recently closed,
// or a single ungrouped section for the simpler digests). The first
// MAX_ACTIONABLE_DIGEST_LINES lines each get their own section with an
// "Open" accessory button straight to buildEditTaskModal — added
// 2026-09-14 so a digest is actionable in Slack itself, not just a
// link out to the web app. Every line still carries its passwordless
// update link too (the same one the email already uses) as a fallback.
export function buildDigestBlocks(intro: string, sections: Array<{ heading?: string; lines: DigestLine[] }>): unknown[] {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: intro } }];
  let actionableUsed = 0;
  for (const section of sections) {
    if (!section.lines.length) continue;
    if (section.heading) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${section.heading}*` } });
    const rest: DigestLine[] = [];
    for (const line of section.lines) {
      if (actionableUsed < MAX_ACTIONABLE_DIGEST_LINES && line.taskId && line.status !== "Closed") {
        actionableUsed++;
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: digestLineText(line) },
          accessory: { type: "button", text: { type: "plain_text", text: "Open" }, action_id: "task_edit_from_digest", value: String(line.taskId) },
        });
      } else {
        rest.push(line);
      }
    }
    // Slack's mrkdwn section text caps at 3000 characters — chunked
    // generously short of that rather than counted exactly, since task
    // subjects vary in length.
    for (let i = 0; i < rest.length; i += 10) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: rest.slice(i, i + 10).map(digestLineText).join("\n") } });
    }
  }
  return blocks;
}

const STATUS_OPTIONS = ["Open", "In progress", "Closed"] as const;

// The "Edit" button's modal — status, due date, reassigning the owner,
// and posting a note, all in one place, added 2026-09-14 to replace
// the original single-field "post an update" modal (still the only
// way to change any of these from Slack — the same operations the web
// app's task drawer already offers). private_metadata carries what
// view_submission needs back: the task id, this message's own
// response_url, and `source` — "card" (opened from a /task or
// real-time-notify card, where response_url can safely replace that
// one message) vs "digest" (opened from a digest's inline button,
// where replacing would blow away every OTHER task's line in the same
// message — see the view_submission handler for how these two differ).
//
// Owner uses Slack's native people picker (users_select) rather than a
// list of Task AI's own known names: matches the polished native UX of
// comparable Slack apps, and the "your Slack email must match your
// Task AI account" constraint it implies isn't new — every other part
// of this integration already requires exactly that (see resolveActor
// in the webhook route). Left unset means "don't change the owner",
// same as due/status being left at their pre-filled current value.
export function buildEditTaskModal(task: { id: number; subject: string; status: string; due: string | null; owner: string }, responseUrl: string, source: "card" | "digest"): unknown {
  return {
    type: "modal",
    callback_id: "task_edit_submit",
    private_metadata: JSON.stringify({ taskId: task.id, responseUrl, source }),
    title: { type: "plain_text", text: "Edit task" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*#${task.id} ${task.subject}*` } },
      {
        type: "input",
        block_id: "status_block",
        label: { type: "plain_text", text: "Status" },
        element: {
          type: "static_select",
          action_id: "status_select",
          options: STATUS_OPTIONS.map(value => ({ text: { type: "plain_text", text: value }, value })),
          initial_option: { text: { type: "plain_text", text: task.status }, value: task.status },
        },
      },
      {
        type: "input",
        block_id: "due_block",
        optional: true,
        label: { type: "plain_text", text: "Due date" },
        element: {
          type: "datepicker",
          action_id: "due_date",
          placeholder: { type: "plain_text", text: "No due date" },
          ...(task.due ? { initial_date: task.due } : {}),
        },
      },
      {
        type: "input",
        block_id: "owner_block",
        optional: true,
        label: { type: "plain_text", text: `Reassign (currently ${task.owner})` },
        element: { type: "users_select", action_id: "owner_select", placeholder: { type: "plain_text", text: "Leave as-is" } },
      },
      {
        type: "input",
        block_id: "update_block",
        optional: true,
        label: { type: "plain_text", text: "What's the update?" },
        element: { type: "plain_text_input", action_id: "update_text", multiline: true },
      },
    ],
  };
}

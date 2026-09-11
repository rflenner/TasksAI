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

// The reminder/task card — one shared builder for both the on-demand
// "/task list" command and (once wired) the automatic reminder crons, so
// a task always looks the same in Slack regardless of what triggered it.
// Delegate is deliberately not a button yet — Update + Close only for
// this first pass, per the agreed sequencing.
export function buildTaskCardBlocks(task: { id: number; subject: string; description: string; status: string; due: string | null; owner: string }): unknown[] {
  const dueLine = task.due ? `Due ${task.due}` : "No due date";
  return [
    { type: "section", text: { type: "mrkdwn", text: `*#${task.id} ${task.subject}*\n${task.description || "_No description_"}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: `${task.status} · ${dueLine} · Owner: ${task.owner}` }] },
    {
      type: "actions",
      block_id: `task_actions_${task.id}`,
      elements: [
        { type: "button", text: { type: "plain_text", text: "Update" }, action_id: "task_update", value: String(task.id) },
        { type: "button", text: { type: "plain_text", text: "Close" }, style: "primary", action_id: "task_close", value: String(task.id) },
      ],
    },
  ];
}

// The "Update" button's modal — a single text field, private_metadata
// carries what the view_submission handler needs back (the task id and
// this message's own response_url, so submitting it can refresh the
// original card) since a modal has no other memory of what opened it.
export function buildUpdateModal(taskId: number, taskSubject: string, responseUrl: string): unknown {
  return {
    type: "modal",
    callback_id: "task_update_submit",
    private_metadata: JSON.stringify({ taskId, responseUrl }),
    title: { type: "plain_text", text: "Post an update" },
    submit: { type: "plain_text", text: "Post" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*#${taskId} ${taskSubject}*` } },
      {
        type: "input",
        block_id: "update_block",
        label: { type: "plain_text", text: "What's the update?" },
        element: { type: "plain_text_input", action_id: "update_text", multiline: true },
      },
    ],
  };
}

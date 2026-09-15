import { requireSameOrigin } from "../../../lib/request";
import { applyTaskUpdateViaToken, resolveTaskUpdateToken } from "../../../lib/task-update-tokens";

// Deliberately no currentActor()/session check anywhere in this route —
// that's the entire point (see app/lib/task-update-tokens.ts). The token
// itself is the credential, scoped to exactly one task, expiring, and
// never logged anywhere in plaintext.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ error: "Missing token" }, { status: 400 });
  const resolved = await resolveTaskUpdateToken(token);
  if (!resolved) return Response.json({ error: "expired" }, { status: 410 });
  const { task, recipientName } = resolved;
  return Response.json({
    recipientName,
    task: { subject: task.subject, description: task.description, status: task.status, due: task.due || null, owner: task.owner },
  });
}

// Thin wrapper around applyTaskUpdateViaToken (app/lib/task-update-tokens.ts)
// — the actual update/history/Slack logic now lives there too, shared with
// the inbound-email reply path, so this route just translates its result
// into the same response shapes it always returned.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const { token, text, status } = await request.json().catch(() => ({})) as { token?: string; text?: string; status?: string };
  if (!token) return Response.json({ error: "Missing token" }, { status: 400 });
  const result = await applyTaskUpdateViaToken(token, text, status);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, task: result.task });
}

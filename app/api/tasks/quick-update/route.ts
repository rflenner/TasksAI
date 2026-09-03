import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tasks } from "../../../../db/schema";
import { requireSameOrigin } from "../../../lib/request";
import { recordActivity } from "../../../lib/task-activity";
import { resolveTaskUpdateToken } from "../../../lib/task-update-tokens";

const STATUSES = ["Open", "In progress", "Closed"] as const;

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

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const { token, text, status } = await request.json().catch(() => ({})) as { token?: string; text?: string; status?: string };
  if (!token) return Response.json({ error: "Missing token" }, { status: 400 });
  const resolved = await resolveTaskUpdateToken(token);
  if (!resolved) return Response.json({ error: "expired" }, { status: 410 });
  const { task, recipientName } = resolved;
  const trimmedText = String(text || "").trim();
  const newStatus = status && (STATUSES as readonly string[]).includes(status) ? status : task.status;
  if (!trimmedText && newStatus === task.status) return Response.json({ error: "Add an update or change the status first" }, { status: 400 });

  const by = `${recipientName} (via email)`;
  const updates = trimmedText ? [...task.updates, { text: trimmedText, at: new Date().toISOString(), by }] : task.updates;
  // Same closedAt bookkeeping PATCH /api/tasks applies: a fresh close gets
  // a new timestamp, an already-closed task editing something else here
  // keeps its original one, reopening clears it.
  const closedAt = newStatus !== "Closed" ? null : task.status === "Closed" ? task.closedAt : new Date();
  const [updated] = await getDb().update(tasks).set({ status: newStatus, updates, closedAt }).where(eq(tasks.id, task.id)).returning();

  // actorName is free text, not a foreign key to users — attributing to
  // `by` (already suffixed "(via email)") keeps Task History reading
  // consistently with the Status Updates log either way this happened.
  const activity: string[] = [];
  if (trimmedText) activity.push(`added an update via email link`);
  if (newStatus !== task.status) activity.push(`changed status from ${task.status} to ${newStatus} via email link`);
  await recordActivity(task.id, by, activity);

  return Response.json({ ok: true, task: { subject: updated.subject, status: updated.status } });
}

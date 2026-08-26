import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dimensionValues, tasks } from "../../../db/schema";
import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";

// Lets a Site Admin remove a bad project/meeting/topic/person name from the
// autocomplete list — e.g. something an AI-extraction run hallucinated from
// meeting minutes. This only removes the *suggestion*: it doesn't touch any
// task that still has the value in its owner/project/topic/meeting field,
// and if such a task is later edited (even an unrelated field), the normal
// task-save path re-inserts the same value here via onConflictDoNothing.
// Full cleanup means also fixing the tasks that still reference it — so the
// response reports how many still do, letting the UI say so.
export async function DELETE(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const { id } = await request.json() as { id?: number };
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const [row] = await getDb().select().from(dimensionValues).where(eq(dimensionValues.id, id)).limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  await getDb().delete(dimensionValues).where(eq(dimensionValues.id, id));
  const all = await getDb().select().from(tasks);
  const stillUsedByTasks = all.filter(t =>
    row.type === "person" ? (t.owner === row.value || t.collaborators.includes(row.value) || t.recipients.includes(row.value)) :
    row.type === "project" ? t.project === row.value :
    row.type === "meeting" ? t.recurringMeeting === row.value :
    row.type === "topic" ? t.topic === row.value : false,
  ).length;
  return Response.json({ ok: true, stillUsedByTasks });
}

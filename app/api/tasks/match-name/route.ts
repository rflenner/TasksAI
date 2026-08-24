import { getDb } from "../../../../db";
import { tasks } from "../../../../db/schema";
import { canSeeTask } from "../../../lib/permissions";
import { taskLineFor, tasksReferencingName } from "../../../lib/pending-tasks";
import { currentActor } from "../../../lib/session";

// Live "N open tasks reference this name" lookup for the invite form —
// lets an admin see (and later, the invitation email include) what's
// waiting for someone who may not have a Task AI account yet, since tasks
// name people by a plain string, not an account id. Scoped through
// canSeeTask first: an area admin can never discover — or accidentally
// reveal to an external invitee — a task outside their own area just by
// typing a name into this box.
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor?.canInvite) return Response.json({ error: "Invitation rights required" }, { status: 403 });
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name) return Response.json({ tasks: [] });
  const all = await getDb().select().from(tasks);
  const visible = all.filter(task => canSeeTask(task, actor));
  const matches = tasksReferencingName(visible, name);
  return Response.json({ tasks: matches.map(task => taskLineFor(task, name)) });
}

import { getDb } from "../../../db";
import { tasks } from "../../../db/schema";
import { canSeeTask } from "../../lib/permissions";
import { currentActor } from "../../lib/session";
import { taskAiCapabilities } from "../../lib/voice-help";

export const dynamic = "force-dynamic";

// The "What can I say?" list for Task AI's voice assistants, with a real
// colleague's first name in the examples (someone on the tasks this person
// can see, never the whole user list).
export async function GET() {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const rows = await getDb().select({ owner: tasks.owner, collaborators: tasks.collaborators, recipients: tasks.recipients, project: tasks.project, topic: tasks.topic, recurringMeeting: tasks.recurringMeeting, mergedIntoTaskId: tasks.mergedIntoTaskId }).from(tasks);
  const mine = actor.name.trim().split(/\s+/)[0].toLowerCase();
  const other = rows.filter(t => !t.mergedIntoTaskId && canSeeTask(t, actor)).flatMap(t => [t.owner, ...t.collaborators, ...t.recipients])
    .map(n => String(n || "").trim().split(/\s+/)[0]).find(n => n && n.toLowerCase() !== mine && /^\p{L}/u.test(n));
  return Response.json({ capabilities: taskAiCapabilities(other || "Maya") });
}

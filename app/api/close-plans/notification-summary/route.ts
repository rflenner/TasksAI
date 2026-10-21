import { loadRules, PAUSED_NOTIFICATIONS } from "../../../lib/close-plan-notify-rules";
import { currentActor } from "../../../lib/session";

export const dynamic = "force-dynamic";

// What the notification rules mean for a task, for the "Who hears about this task" box: any signed-in user can read this much
// (the full rules stay with Site Admins).
export async function GET() {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { assignment } = await loadRules();
  return Response.json({ assignment, paused: PAUSED_NOTIFICATIONS }, { headers: { "cache-control": "no-store" } });
}

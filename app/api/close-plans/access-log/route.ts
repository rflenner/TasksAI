import { accessPlans, listAccess } from "../../../lib/close-plan-access-log";
import { currentActor } from "../../../lib/session";

export const dynamic = "force-dynamic";

// The access log (who logged in or opened a plan, what they viewed and changed). Site admins only.
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const q = new URL(request.url).searchParams, num = (k: string) => Number(q.get(k)) || undefined;
  const result = await listAccess({ plan: q.get("plan") || undefined, who: (q.get("who") || "").trim().slice(0, 80) || undefined, event: q.get("event") || undefined, sinceDays: num("days"), before: num("before") });
  return Response.json({ ...result, ...(q.get("facets") ? { plans: await accessPlans() } : {}) }, { headers: { "cache-control": "no-store" } });
}

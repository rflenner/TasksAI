import { loadRules, saveRules } from "../../../lib/close-plan-notify-rules";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

export const dynamic = "force-dynamic";

// The Close Plan notification rules, for Site Admins (Admin → Notifications).
export async function GET() {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  return Response.json({ rules: await loadRules() });
}
export async function PUT(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { rules?: unknown } | null;
  if (!body || typeof body.rules !== "object") return Response.json({ error: "Rules missing" }, { status: 400 });
  return Response.json({ rules: await saveRules(body.rules, actor.id ?? null) });
}

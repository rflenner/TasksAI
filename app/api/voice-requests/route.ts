import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";
import { cleanRequestName, REQUEST_STATUSES, type RequestStatus, setRequestStatus } from "../../lib/voice-requests";

export const dynamic = "force-dynamic";

// The team's decision on a voice request (new / planned / built / won't do). Site admins only.
export async function PATCH(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin") return Response.json({ error: "Site admins only" }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown; status?: unknown; note?: unknown } | null;
  const name = cleanRequestName(body?.name);
  const status = (REQUEST_STATUSES as readonly string[]).includes(String(body?.status)) ? body!.status as RequestStatus : null;
  if (!name || !status) return Response.json({ error: "Name and status are required" }, { status: 400 });
  await setRequestStatus(name, status, String(body?.note || "").slice(0, 500), actor.id ?? null);
  return Response.json({ ok: true });
}

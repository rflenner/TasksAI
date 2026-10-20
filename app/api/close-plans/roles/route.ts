import { loadRoles, loadRoleUsage, saveRoles, validateRoles } from "../../../lib/close-plan-roles";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

export const dynamic = "force-dynamic";

// The roles people can have on a Close Plan. Anyone signed in reads the list (the plan page uses it for its role pickers); Site Admins edit it
// (Admin → Close Plan roles) and see how many people have each role.
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const roles = await loadRoles();
  if (new URL(request.url).searchParams.get("usage") === "1") {
    if (actor.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
    return Response.json({ roles, usage: await loadRoleUsage() });
  }
  return Response.json({ roles });
}

export async function PUT(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { roles?: unknown } | null;
  const checked = validateRoles(body?.roles);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
  const result = await saveRoles(checked.roles, actor.id ?? null);
  return Response.json({ roles: checked.roles, usage: await loadRoleUsage(), ...result });
}

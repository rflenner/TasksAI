import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companies, users } from "../../../../db/schema";
import { currentActor } from "../../../lib/session";

// Active Task AI users the Close Plan guide and People tab can add to a plan.
// Deliberately lean (name, email, company) rather than reusing GET
// /api/users, which returns scopes, activity and invitation details and
// needs invitation rights. Same admin-only rule as the Sales AI search.
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin" && actor.role !== "area_admin") return Response.json({ error: "Only admins can add Task AI users to a plan" }, { status: 403 });
  const rows = await getDb().select({ id: users.id, name: users.name, email: users.email, company: companies.name })
    .from(users).leftJoin(companies, eq(companies.id, users.companyId))
    .where(eq(users.status, "active")).orderBy(asc(users.name));
  return Response.json({ me: { name: actor.name, email: actor.email }, users: rows.map(u => ({ id: u.id, name: u.name, email: u.email, company: u.company || "" })) });
}

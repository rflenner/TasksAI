import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { requireSameOrigin } from "../../../lib/request";
import { hashPassword, randomTempPassword } from "../../../lib/security";
import { currentActor } from "../../../lib/session";

// Site Admin only — deliberately stricter than mayManageRole (which an
// area admin also passes for most user actions): this hands out a working
// login credential, not a scope/role tweak, so it stays behind the one
// role that can already do anything else in the app. Only ever generates
// a temporary password and returns it once in the response — the admin
// relays it themselves, out of band, to whoever needs it (see
// db/schema.ts's passwordHash comment for why this can't be a normal
// self-service "email me a reset link" flow). Only for an active user —
// a pending invite has its own acceptance flow, and a revoked user
// shouldn't be handed a fresh way in at all.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const { userId } = await request.json().catch(() => ({})) as { userId?: number };
  if (!userId) return Response.json({ error: "User id is required" }, { status: 400 });
  const [target] = await getDb().select({ id: users.id, status: users.status, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return Response.json({ error: "User not found" }, { status: 404 });
  if (target.status !== "active") return Response.json({ error: "Only an active user can be given a password — a pending invite uses its own link, not this." }, { status: 400 });

  const password = randomTempPassword();
  const passwordSetAt = new Date();
  await getDb().update(users).set({
    passwordHash: await hashPassword(password),
    passwordSetAt,
    passwordFailedAttempts: 0,
    passwordLockedUntil: null,
  }).where(eq(users.id, userId));

  // Echoes passwordSetAt (never passwordHash) back alongside the raw
  // password, so the admin UI can update its "Set a password" / "Reset
  // password" button label without a full user-list reload.
  return Response.json({ password, userId, passwordSetAt });
}

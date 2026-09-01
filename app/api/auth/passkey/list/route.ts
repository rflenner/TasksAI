import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { passkeys } from "../../../../../db/schema";
import { currentActor } from "../../../../lib/session";

export async function GET() {
  const actor = await currentActor();
  if (!actor?.id) return Response.json({ error: "Sign in required" }, { status: 401 });
  const rows = await getDb().select({ id: passkeys.id, deviceLabel: passkeys.deviceLabel, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt }).from(passkeys).where(eq(passkeys.userId, actor.id)).orderBy(passkeys.createdAt);
  return Response.json({ passkeys: rows });
}

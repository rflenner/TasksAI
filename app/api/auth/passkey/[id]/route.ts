import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { passkeys } from "../../../../../db/schema";
import { requireSameOrigin } from "../../../../lib/request";
import { currentActor } from "../../../../lib/session";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor?.id) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number((await params).id);
  if (!id) return Response.json({ error: "Passkey id is required" }, { status: 400 });
  // Scoped to actor.id in the WHERE clause, not just looked up then checked
  // — a user can only ever delete their own passkey this way, full stop.
  const [row] = await getDb().delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, actor.id))).returning();
  if (!row) return Response.json({ error: "Passkey not found" }, { status: 404 });
  return Response.json({ ok: true });
}

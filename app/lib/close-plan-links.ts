import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanDocuments, closePlanLinks } from "../../db/schema";
import { customerPerson } from "./close-plan-share";
import { randomToken, sha256 } from "./security";

// How long a personal link works. Long enough for a deal cycle's worth of
// check-ins; the iSEEit plan owner can create a fresh one at any time.
export const CLOSE_PLAN_LINK_VALID_DAYS = 60;

export async function createPlanLink(planId: string, personId: string, createdBy: number | null) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + CLOSE_PLAN_LINK_VALID_DAYS * 86400000);
  await getDb().insert(closePlanLinks).values({ planId, personId, tokenHash: sha256(token), createdBy, expiresAt });
  return { token, expiresAt };
}

export async function revokePlanLinks(planId: string, personId: string) {
  await getDb().update(closePlanLinks).set({ revokedAt: new Date() })
    .where(and(eq(closePlanLinks.planId, planId), eq(closePlanLinks.personId, personId), isNull(closePlanLinks.revokedAt)));
}

// A raw token from a link back to its plan row and person, or null when the link
// is unknown, expired, revoked, the plan is deleted, or the person is no longer a
// customer contact on the plan. Never throws on a bad token: that's an everyday case.
export async function resolvePlanLink(rawToken: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(rawToken)) return null;
  const [link] = await getDb().select().from(closePlanLinks).where(eq(closePlanLinks.tokenHash, sha256(rawToken))).limit(1);
  if (!link || link.revokedAt || link.expiresAt < new Date()) return null;
  const [row] = await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, link.planId)).limit(1);
  if (!row || row.deletedAt || !customerPerson(row.data, link.personId)) return null;
  return { link, row };
}

export async function touchPlanLink(id: number) {
  await getDb().update(closePlanLinks).set({ lastUsedAt: new Date() }).where(eq(closePlanLinks.id, id));
}

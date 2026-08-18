import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../../db";
import { sessions, users } from "../../db/schema";
import type { Actor } from "./permissions";
import { randomToken, sha256, signedValue, verifySignedValue } from "./security";

export const SESSION_COOKIE = "task_ai_session";
const MAX_AGE = 30 * 24 * 60 * 60;
export async function createSession(userId: number) {
  const id = randomToken(), expiresAt = new Date(Date.now() + MAX_AGE * 1000);
  await getDb().insert(sessions).values({ idHash: sha256(id), userId, expiresAt });
  return { value: signedValue(id), expiresAt };
}
export async function setSessionCookie(value: string, expiresAt: Date) { (await cookies()).set(SESSION_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt }); }
export async function clearSession() { const jar=await cookies(),id=verifySignedValue(jar.get(SESSION_COOKIE)?.value);if(id)await getDb().delete(sessions).where(eq(sessions.idHash,sha256(id)));jar.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 }); }
export async function currentActor(): Promise<Actor | null> {
  const id = verifySignedValue((await cookies()).get(SESSION_COOKIE)?.value); if (!id) return null;
  const [row] = await getDb().select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status, canInvite: users.canInvite, projects: users.projects, meetings: users.meetings, topics: users.topics }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.idHash, sha256(id)), gt(sessions.expiresAt, new Date()), eq(users.status, "active"))).limit(1);
  return row ?? null;
}

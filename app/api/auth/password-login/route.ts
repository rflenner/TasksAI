import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { requireSameOrigin } from "../../../lib/request";
import { verifyPassword } from "../../../lib/security";
import { createSession, setSessionCookie } from "../../../lib/session";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
// Never distinguishes "no such account" / "not active" / "no password
// ever set" / "wrong password" — same principle /api/auth/login already
// follows for the code-based flow, just more load-bearing here since a
// password is guessable in a way a random login code isn't.
const GENERIC_ERROR = "Incorrect email or password.";

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const { email, password } = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !password) return Response.json({ error: GENERIC_ERROR }, { status: 400 });

  const [user] = await getDb().select().from(users).where(and(eq(users.email, cleanEmail), eq(users.status, "active"))).limit(1);
  if (!user) return Response.json({ error: GENERIC_ERROR }, { status: 400 });

  if (user.passwordLockedUntil && user.passwordLockedUntil > new Date()) {
    return Response.json({ error: "Too many attempts — try again in a few minutes, or ask your admin for a fresh password." }, { status: 429 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const attempts = user.passwordFailedAttempts + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null;
    await getDb().update(users).set({ passwordFailedAttempts: attempts, passwordLockedUntil: lockedUntil }).where(eq(users.id, user.id));
    return Response.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  await getDb().update(users).set({ passwordFailedAttempts: 0, passwordLockedUntil: null }).where(eq(users.id, user.id));
  const session = await createSession(user.id); await setSessionCookie(session.value, session.expiresAt);
  return Response.json({ user: { id: user.id, name: user.name, email: user.email } });
}

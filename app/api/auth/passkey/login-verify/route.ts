import { eq } from "drizzle-orm";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, WebAuthnCredential } from "@simplewebauthn/server";
import { getDb } from "../../../../../db";
import { passkeys, users } from "../../../../../db/schema";
import { requireSameOrigin } from "../../../../lib/request";
import { rpID, rpOrigin, takeChallengeCookie } from "../../../../lib/passkey";
import { createSession, setSessionCookie } from "../../../../lib/session";

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const challenge = await takeChallengeCookie();
  if (!challenge) return Response.json({ error: "That sign-in attempt expired — try again" }, { status: 400 });

  const response = await request.json() as AuthenticationResponseJSON;
  const [stored] = await getDb().select().from(passkeys).where(eq(passkeys.credentialId, response.id)).limit(1);
  if (!stored) return Response.json({ error: "That passkey isn't registered here" }, { status: 400 });

  const credential: WebAuthnCredential = { id: stored.credentialId, publicKey: isoBase64URL.toBuffer(stored.publicKey), counter: stored.counter, transports: stored.transports as WebAuthnCredential["transports"] };
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: rpOrigin(request), expectedRPID: rpID(request), credential,
    });
  } catch {
    return Response.json({ error: "Could not verify that passkey" }, { status: 400 });
  }
  if (!verification.verified) return Response.json({ error: "Could not verify that passkey" }, { status: 400 });

  const [user] = await getDb().select().from(users).where(eq(users.id, stored.userId)).limit(1);
  if (!user || user.status !== "active") return Response.json({ error: "This account is no longer active" }, { status: 403 });

  await getDb().update(passkeys).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeys.id, stored.id));
  const session = await createSession(user.id);
  await setSessionCookie(session.value, session.expiresAt);
  return Response.json({ ok: true });
}

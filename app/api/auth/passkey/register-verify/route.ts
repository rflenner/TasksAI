import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getDb } from "../../../../../db";
import { passkeys } from "../../../../../db/schema";
import { requireSameOrigin } from "../../../../lib/request";
import { rpID, rpOrigin, takeChallengeCookie } from "../../../../lib/passkey";
import { currentActor } from "../../../../lib/session";

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor?.id) return Response.json({ error: "Sign in required" }, { status: 401 });

  const challenge = await takeChallengeCookie();
  if (!challenge) return Response.json({ error: "That registration attempt expired — try again" }, { status: 400 });

  const { response, deviceLabel } = await request.json() as { response: RegistrationResponseJSON; deviceLabel?: string };
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: rpOrigin(request), expectedRPID: rpID(request),
    });
  } catch {
    return Response.json({ error: "Could not verify that passkey" }, { status: 400 });
  }
  if (!verification.verified) return Response.json({ error: "Could not verify that passkey" }, { status: 400 });

  const { credential } = verification.registrationInfo;
  const [row] = await getDb().insert(passkeys).values({
    userId: actor.id,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports || [],
    deviceLabel: deviceLabel?.trim().slice(0, 60) || null,
  }).onConflictDoNothing().returning();
  if (!row) return Response.json({ error: "That passkey is already registered" }, { status: 409 });
  return Response.json({ ok: true });
}

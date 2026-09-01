import { eq } from "drizzle-orm";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { getDb } from "../../../../../db";
import { passkeys } from "../../../../../db/schema";
import { requireSameOrigin } from "../../../../lib/request";
import { rpID, setChallengeCookie } from "../../../../lib/passkey";
import { currentActor } from "../../../../lib/session";

// Registering a passkey requires already being signed in via some other
// method first — WebAuthn has no concept of "who is this," it only proves
// "this device holds a credential." Binding a new credential to an account
// is entirely our own logic: whoever's session cookie is valid right now
// is who the new credential gets attached to.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor?.id) return Response.json({ error: "Sign in required" }, { status: 401 });

  const existing = await getDb().select({ credentialId: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, actor.id));

  const options = await generateRegistrationOptions({
    rpName: "Task AI",
    rpID: rpID(request),
    userID: isoUint8Array.fromUTF8String(String(actor.id)),
    userName: actor.email,
    userDisplayName: actor.name,
    attestationType: "none",
    // residentKey required — a discoverable credential, so signing back in
    // never needs to know the email/account up front (see login-options).
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    excludeCredentials: existing.map(row => ({ id: row.credentialId, transports: row.transports as ("ble" | "hybrid" | "internal" | "nfc" | "usb")[] })),
  });
  await setChallengeCookie(options.challenge);
  return Response.json(options);
}

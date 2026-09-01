import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { requireSameOrigin } from "../../../../lib/request";
import { rpID, setChallengeCookie } from "../../../../lib/passkey";

// No allowCredentials — this is the "usernameless" flow: the browser asks
// the platform authenticator which discoverable credentials it has for
// this site and presents them directly, no email typed first. Public,
// unauthenticated by design — that's the entire point of signing in.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const options = await generateAuthenticationOptions({ rpID: rpID(request), userVerification: "preferred" });
  await setChallengeCookie(options.challenge);
  return Response.json(options);
}

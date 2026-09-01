import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { appLinkOrigin } from "../../../../lib/request";
import { randomToken, signedValue } from "../../../../lib/security";

// Kicks off the OAuth 2.0 Authorization Code flow with PKCE. State + code
// verifier live in a short-lived signed cookie rather than a DB row — this
// flow never lasts more than a couple of minutes end to end, so there's no
// need to persist it anywhere durable, and it keeps the same "everything
// signed, nothing server-stored" shape as the rest of this app's auth.
export const OAUTH_STATE_COOKIE = "task_ai_google_oauth";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return Response.json({ error: "Google sign-in isn't configured yet" }, { status: 503 });

  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  (await cookies()).set(OAUTH_STATE_COOKIE, signedValue(JSON.stringify({ state, verifier })), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
  });

  const redirectUri = new URL("/api/auth/google/callback", appLinkOrigin(request)).toString();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}

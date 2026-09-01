import { cookies } from "next/headers";
import { appLinkOrigin } from "./request";
import { signedValue, verifySignedValue } from "./security";

// rpID must be the bare hostname (no scheme/port) — the domain the
// credential is scoped to. rpOrigin is the full origin WebAuthn checks the
// response against. Both derived from APP_URL (via appLinkOrigin) rather
// than hardcoded, so this keeps working automatically through any future
// domain change — see appLinkOrigin's own comment for why that's the
// env-var-preferred one, not the request-tied one.
export function rpID(request: Request) {
  return new URL(appLinkOrigin(request)).hostname;
}
export function rpOrigin(request: Request) {
  return appLinkOrigin(request);
}

// The registration/authentication challenge only needs to survive the
// few seconds between "generate options" and "verify response" — a
// short-lived signed cookie, same scheme as the Google OAuth state cookie,
// rather than a DB row.
const CHALLENGE_COOKIE = "task_ai_passkey_challenge";
export async function setChallengeCookie(challenge: string) {
  (await cookies()).set(CHALLENGE_COOKIE, signedValue(challenge), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 300,
  });
}
export async function takeChallengeCookie(): Promise<string | null> {
  const jar = await cookies();
  const challenge = verifySignedValue(jar.get(CHALLENGE_COOKIE)?.value);
  jar.set(CHALLENGE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return challenge;
}

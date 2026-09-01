import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../../../../../db";
import { users } from "../../../../../db/schema";
import { appLinkOrigin } from "../../../../lib/request";
import { createSession, setSessionCookie } from "../../../../lib/session";
import { verifySignedValue } from "../../../../lib/security";
import { OAUTH_STATE_COOKIE } from "../start/route";

// Exchanges the authorization code for a token, confirms the email with
// Google directly over an authenticated HTTPS call (userinfo endpoint) —
// deliberately simpler than independently verifying the ID token's JWT
// signature (would need to fetch and cache Google's JWKS), and just as
// trustworthy since the guarantee comes from the TLS channel straight to
// Google, not from decoding a token client-side. Same invite-only rule as
// the email/code login: this only signs someone in if their Google email
// already matches an existing *active* Task AI account — it never creates
// one. An unrecognized email gets sent back with an explanatory error
// rather than a new account.
function fail(origin: string, reason: string) {
  return Response.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`, 302);
}

export async function GET(request: Request) {
  const origin = appLinkOrigin(request);
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(origin, "Google sign-in isn't configured yet");

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return fail(origin, "Google sign-in was cancelled");
  const code = url.searchParams.get("code"), returnedState = url.searchParams.get("state");
  if (!code || !returnedState) return fail(origin, "That Google sign-in link is incomplete");

  const jar = await cookies();
  const raw = verifySignedValue(jar.get(OAUTH_STATE_COOKIE)?.value);
  jar.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  if (!raw) return fail(origin, "That Google sign-in link expired — try again");
  const { state, verifier } = JSON.parse(raw) as { state: string; verifier: string };
  if (state !== returnedState) return fail(origin, "That Google sign-in link expired — try again");

  const redirectUri = new URL("/api/auth/google/callback", origin).toString();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!tokenRes.ok) return fail(origin, "Could not complete Google sign-in");
  const tokenData = await tokenRes.json() as { access_token?: string };
  if (!tokenData.access_token) return fail(origin, "Could not complete Google sign-in");

  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokenData.access_token}` } });
  if (!profileRes.ok) return fail(origin, "Could not complete Google sign-in");
  const profile = await profileRes.json() as { email?: string; email_verified?: boolean };
  if (!profile.email || !profile.email_verified) return fail(origin, "Your Google account's email isn't verified");

  const [user] = await getDb().select().from(users).where(and(eq(users.email, profile.email.toLowerCase()), eq(users.status, "active"))).limit(1);
  if (!user) return fail(origin, "No Task AI account found for that Google account — ask an admin to invite you");

  const session = await createSession(user.id);
  await setSessionCookie(session.value, session.expiresAt);
  return Response.redirect(origin, 302);
}

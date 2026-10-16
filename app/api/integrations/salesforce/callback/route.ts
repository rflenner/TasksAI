import { cookies } from "next/headers";
import { appLinkOrigin } from "../../../../lib/request";
import { SALESFORCE_CALLBACK_PATH, SALESFORCE_OAUTH_STATE_COOKIE, exchangeAuthorizationCode, saveSalesforceConnection } from "../../../../lib/salesforce";
import { validateSalesforceDomain } from "../../../../lib/salesforce-domain";
import { verifySignedValue } from "../../../../lib/security";
import { currentActor } from "../../../../lib/session";

// Where Salesforce sends the browser back — Sales AI's GET
// /salesforce/callback. Completes the exchange server-side, so the
// authorization code never reaches page script, then bounces back to
// /integrations with ?sfConnect=success|error for the card to report.
// Unlike Sales AI's (which arrives with no session and resolves the tenant
// from state), this one also requires the same signed-in Site Admin who
// started the connect: the session cookie is SameSite=Lax, so it rides
// along on this top-level redirect. The message on failure is always the
// same fixed text; the real reason goes to the server log only, since the
// query string here is attacker-reachable.
const FAILURE_MESSAGE = "Salesforce connection failed. Please try connecting again.";

function back(origin: string, ok: boolean) {
  const params = new URLSearchParams({ sfConnect: ok ? "success" : "error" });
  if (!ok) params.set("message", FAILURE_MESSAGE);
  return Response.redirect(`${origin}/integrations?${params.toString()}`, 302);
}

export async function GET(request: Request) {
  const origin = appLinkOrigin(request);
  const url = new URL(request.url);
  const jar = await cookies();
  const raw = verifySignedValue(jar.get(SALESFORCE_OAUTH_STATE_COOKIE)?.value);
  // One-time: clear it on every path, success or not.
  jar.set(SALESFORCE_OAUTH_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: SALESFORCE_CALLBACK_PATH, maxAge: 0 });

  if (url.searchParams.get("error")) {
    console.warn("Salesforce connect returned an error:", url.searchParams.get("error"), url.searchParams.get("error_description") || "");
    return back(origin, false);
  }
  const code = url.searchParams.get("code"), returnedState = url.searchParams.get("state");
  if (!code || !returnedState || !raw) { console.warn("Salesforce connect callback missing code, state or state cookie"); return back(origin, false); }

  let stored: { state?: string; verifier?: string; domain?: string; userId?: number };
  try { stored = JSON.parse(raw); } catch { return back(origin, false); }
  if (stored.state !== returnedState || !stored.verifier || !stored.domain || !validateSalesforceDomain(stored.domain).valid) {
    console.warn("Salesforce connect callback with unknown or expired state");
    return back(origin, false);
  }

  const actor = await currentActor();
  if (actor?.role !== "site_admin" || actor.id !== stored.userId) {
    console.warn("Salesforce connect callback without the Site Admin session that started it");
    return back(origin, false);
  }

  try {
    const tokens = await exchangeAuthorizationCode({ domain: stored.domain, code, verifier: stored.verifier, redirectUri: new URL(SALESFORCE_CALLBACK_PATH, origin).toString() });
    await saveSalesforceConnection({ domain: stored.domain, tokens, connectedBy: actor.name });
    return back(origin, true);
  } catch (error) {
    console.error("Salesforce connect exchange failed:", error instanceof Error ? error.message : error);
    return back(origin, false);
  }
}

import { cookies } from "next/headers";
import { appLinkOrigin, requireSameOrigin } from "../../../../lib/request";
import { SALESFORCE_CALLBACK_PATH, SALESFORCE_OAUTH_STATE_COOKIE, buildAuthorizeUrl, generatePkce, getSalesforceStatus, saveSalesforceDomain, salesforceClient } from "../../../../lib/salesforce";
import { validateSalesforceDomain } from "../../../../lib/salesforce-domain";
import { randomToken, signedValue } from "../../../../lib/security";
import { currentActor } from "../../../../lib/session";

// Starts the Salesforce connect — Sales AI's POST /salesforce/redirect-url.
// Returns the authorize URL for the browser to navigate to rather than
// redirecting, same as Sales AI, so the card can show an error inline
// instead of bouncing the admin to a broken page. The PKCE verifier,
// state, domain and the admin who started it ride in a signed, HttpOnly,
// ten-minute cookie scoped to the callback's path (see
// app/api/auth/google/start/route.ts for why a cookie and not a DB row).
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });

  const client = salesforceClient();
  if (!client) return Response.json({ error: "Salesforce isn't configured yet — set SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as { domain?: unknown };
  const domain = typeof body.domain === "string" && body.domain.trim() ? body.domain.trim() : (await getSalesforceStatus()).domain;
  const { valid, error } = validateSalesforceDomain(domain);
  if (!valid) return Response.json({ error }, { status: 400 });
  await saveSalesforceDomain(domain);

  const state = randomToken(16);
  const { verifier, challenge } = generatePkce();
  (await cookies()).set(SALESFORCE_OAUTH_STATE_COOKIE, signedValue(JSON.stringify({ state, verifier, domain, userId: actor.id })), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: SALESFORCE_CALLBACK_PATH, maxAge: 600,
  });

  const redirectUri = new URL(SALESFORCE_CALLBACK_PATH, appLinkOrigin(request)).toString();
  return Response.json({ authorizeUrl: buildAuthorizeUrl({ domain, clientId: client.clientId, redirectUri, state, challenge }) });
}

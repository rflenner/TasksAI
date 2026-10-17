import { requireSameOrigin } from "../../../lib/request";
import { disconnectSalesforce, ensureSalesforceTokenFresh, getSalesforceStatus, saveSalesforceDomain } from "../../../lib/salesforce";
import { validateSalesforceDomain } from "../../../lib/salesforce-domain";
import { currentActor } from "../../../lib/session";

// The Salesforce card on /integrations: connection status (GET), the
// login-domain field (PATCH, saved on blur like Sales AI's
// sfRedirectURL), and Disconnect (DELETE). Site Admin only, like the rest
// of /integrations. Connect itself is POST ./connect + GET ./callback.
async function requireSiteAdmin() {
  const actor = await currentActor();
  return actor?.role === "site_admin" ? actor : null;
}
const forbidden = () => Response.json({ error: "Site Admin access required" }, { status: 403 });

export async function GET() {
  if (!await requireSiteAdmin()) return forbidden();
  // Nothing in Task AI uses the token in the background yet, so nothing
  // would ever notice a dead refresh token. Opening the card refreshes a
  // stale one (at most every 30 minutes) — that's what lets "Expired"
  // show up here the way it does in Sales AI, whose syncs hit it constantly.
  const before = await getSalesforceStatus();
  if (before.isConnected) {
    try { await ensureSalesforceTokenFresh(); }
    catch (error) { console.warn("Salesforce token check failed:", error instanceof Error ? error.message : error); }
  }
  return Response.json(await getSalesforceStatus());
}

export async function PATCH(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await requireSiteAdmin()) return forbidden();
  const body = await request.json().catch(() => ({})) as { domain?: unknown };
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  const { valid, error } = validateSalesforceDomain(domain);
  if (!valid) return Response.json({ error }, { status: 400 });
  // The field is read-only on the card while connected; enforce it here too.
  if ((await getSalesforceStatus()).isConnected) return Response.json({ error: "Disconnect Salesforce before changing its domain" }, { status: 409 });
  await saveSalesforceDomain(domain);
  return Response.json(await getSalesforceStatus());
}

export async function DELETE(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await requireSiteAdmin()) return forbidden();
  await disconnectSalesforce();
  return Response.json(await getSalesforceStatus());
}

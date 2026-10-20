import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { salesforceConnection } from "../../db/schema";
import { DEFAULT_SALESFORCE_DOMAIN, isSalesforceHost } from "./salesforce-domain";
import { randomToken } from "./security";

// Salesforce CRM connection — a port of Sales AI's Connected Apps
// "Salesforce" card (iseeit-conversation-app: backend
// app/salesforce/salesforce-oauth.service.js, frontend
// pages/connectedApps/SalesforceConnectionCard.jsx). Same flow: the admin
// types their Salesforce login domain, Connect runs the OAuth 2.0
// authorization-code flow with PKCE against that domain, the token pair
// is stored for the workspace, and a refresh that Salesforce rejects with
// invalid_grant marks the connection "expired" so the card can say
// "reconnect". Differences, all deliberate:
// - PKCE state lives in a short-lived signed cookie (same as Google
//   sign-in, app/api/auth/google/start/route.ts) rather than Redis — Task
//   AI has no Redis, and the flow never outlives ten minutes.
// - Tokens are encrypted at rest (AES-256-GCM, key derived from
//   SESSION_SECRET). Rotating SESSION_SECRET therefore also means
//   reconnecting Salesforce: an undecryptable token reads as "expired".
// - The domain must be a Salesforce-owned host (app/lib/salesforce-domain.ts).
//   The token exchange POSTs the client secret to that domain, so a
//   free-form domain would let anyone who can edit it collect the secret.
// - Disconnect also revokes the refresh token at Salesforce (best-effort).

export const SALESFORCE_OAUTH_STATE_COOKIE = "task_ai_salesforce_oauth";
export const SALESFORCE_OAUTH_SCOPE = "api refresh_token";
export const SALESFORCE_CALLBACK_PATH = "/api/integrations/salesforce/callback";
const MAX_ACCESS_TOKEN_AGE_MS = 30 * 60 * 1000;
const SALESFORCE_TIMEOUT_MS = 15000;

export type SalesforceTokenStatus = "active" | "expired";
export type SalesforceStatus = { domain: string; isConnected: boolean; tokenStatus: SalesforceTokenStatus | null; connectedBy: string | null; connectedAt: string | null };
export type SalesforceTokens = { accessToken: string; refreshToken: string; instanceUrl: string };

// The instance URL comes back from Salesforce's own token endpoint, but
// it's still checked before the refresh/revoke calls send a secret to it.
function instanceHost(instanceUrl: string) {
  const url = new URL(instanceUrl);
  if (url.protocol !== "https:" || !isSalesforceHost(url.hostname)) throw new Error("Salesforce returned an unexpected instance URL");
  return url.host;
}

export function generatePkce() {
  const verifier = randomToken(32);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl({ domain, clientId, redirectUri, state, challenge }: { domain: string; clientId: string; redirectUri: string; state: string; challenge: string }) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SALESFORCE_OAUTH_SCOPE, code_challenge: challenge, code_challenge_method: "S256", state });
  return `https://${domain}/services/oauth2/authorize?${params.toString()}`;
}

export function salesforceClient() {
  const clientId = process.env.SALESFORCE_CLIENT_ID, clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// --- token encryption ---------------------------------------------------
function tokenKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "", "task-ai:salesforce-token:v1", 32));
}
export function encryptToken(plain: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
export function decryptToken(stored: string) {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognized Salesforce token format");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// --- Salesforce token endpoint -------------------------------------------
// Mirrors Sales AI's validateSalesforceTokenResponse: a structured `error`
// field (e.g. "invalid_grant") is Salesforce actually rejecting the
// request, kept on the thrown error as salesforceErrorCode so the refresh
// path can tell "this refresh token is dead" from a network blip.
export class SalesforceOAuthError extends Error {
  constructor(message: string, readonly salesforceErrorCode: string | null) { super(message); }
}

async function postToken(host: string, form: Record<string, string>) {
  const response = await fetch(`https://${host}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(SALESFORCE_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; instance_url?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token || !body.instance_url) {
    const message = [body.error, body.error_description].filter(Boolean).join(": ") || `Salesforce token request failed (${response.status})`;
    throw new SalesforceOAuthError(message, body.error || null);
  }
  return body as { access_token: string; refresh_token?: string; instance_url: string };
}

export async function exchangeAuthorizationCode({ domain, code, verifier, redirectUri }: { domain: string; code: string; verifier: string; redirectUri: string }): Promise<SalesforceTokens> {
  const client = salesforceClient();
  if (!client) throw new Error("Salesforce isn't configured yet");
  const body = await postToken(domain, { grant_type: "authorization_code", client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, code, code_verifier: verifier });
  if (!body.refresh_token) throw new SalesforceOAuthError("Salesforce did not return a refresh token. Reauthorize Salesforce with refresh_token scope.", null);
  instanceHost(body.instance_url);
  return { accessToken: body.access_token, refreshToken: body.refresh_token, instanceUrl: body.instance_url };
}

async function refreshTokens(refreshToken: string, instanceUrl: string): Promise<SalesforceTokens> {
  const client = salesforceClient();
  if (!client) throw new Error("Salesforce isn't configured yet");
  const body = await postToken(instanceHost(instanceUrl), { grant_type: "refresh_token", client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refreshToken });
  instanceHost(body.instance_url);
  // Salesforce only returns a new refresh token when rotation is on — keep
  // the old one otherwise, same as Sales AI's refreshSalesforceTokens.
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? refreshToken, instanceUrl: body.instance_url };
}

// --- persistence ---------------------------------------------------------
async function connectionRow() {
  const [row] = await getDb().select().from(salesforceConnection).where(eq(salesforceConnection.id, 1)).limit(1);
  return row ?? null;
}

export async function getSalesforceStatus(): Promise<SalesforceStatus> {
  const row = await connectionRow();
  const isConnected = Boolean(row?.refreshTokenEnc && row.instanceUrl);
  return {
    domain: row?.domain || DEFAULT_SALESFORCE_DOMAIN,
    isConnected,
    tokenStatus: isConnected ? (row?.tokenStatus as SalesforceTokenStatus | null) ?? null : null,
    connectedBy: isConnected ? row?.connectedBy ?? null : null,
    connectedAt: isConnected ? row?.connectedAt?.toISOString() ?? null : null,
  };
}

export async function saveSalesforceDomain(domain: string) {
  await getDb().insert(salesforceConnection).values({ id: 1, domain, updatedAt: new Date() })
    .onConflictDoUpdate({ target: salesforceConnection.id, set: { domain, updatedAt: new Date() } });
}

// A manual (re)connect is an explicit admin action, so it always wins
// over whatever was stored — same as Sales AI's unguarded upsert path.
export async function saveSalesforceConnection({ domain, tokens, connectedBy }: { domain: string; tokens: SalesforceTokens; connectedBy: string }) {
  const now = new Date();
  const values = { domain, instanceUrl: tokens.instanceUrl, accessTokenEnc: encryptToken(tokens.accessToken), refreshTokenEnc: encryptToken(tokens.refreshToken), tokenObtainedAt: now, tokenStatus: "active", connectedBy, connectedAt: now, updatedAt: now };
  await getDb().insert(salesforceConnection).values({ id: 1, ...values })
    .onConflictDoUpdate({ target: salesforceConnection.id, set: values });
}

// Clears the credential but keeps the domain, like Sales AI (whose domain
// lives on the tenant row and survives truncating salesforce_cred).
export async function disconnectSalesforce() {
  const row = await connectionRow();
  if (row?.refreshTokenEnc && row.instanceUrl) {
    try {
      const host = instanceHost(row.instanceUrl);
      await fetch(`https://${host}/services/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decryptToken(row.refreshTokenEnc) }),
        signal: AbortSignal.timeout(SALESFORCE_TIMEOUT_MS),
      });
    } catch (error) {
      // Revoking is a courtesy — the stored copy is deleted either way.
      console.warn("Salesforce token revoke failed:", error instanceof Error ? error.message : error);
    }
  }
  await getDb().update(salesforceConnection)
    .set({ instanceUrl: null, accessTokenEnc: null, refreshTokenEnc: null, tokenObtainedAt: null, tokenStatus: null, connectedBy: null, connectedAt: null, updatedAt: new Date() })
    .where(eq(salesforceConnection.id, 1));
}

// --- REST API -------------------------------------------------------------
export const SALESFORCE_API_VERSION = "v62.0"; // same as Sales AI's SF_API_VERSION

export class SalesforceNotConnectedError extends Error {
  constructor() { super("Salesforce isn't connected, or its access has expired. Reconnect it on Integrations."); }
}

// Every Salesforce REST call goes through here: a fresh token from the
// locked choke point below, a timeout, and one retry on a 401 forcing a
// refresh of exactly the token that failed (Sales AI's
// salesforceApiWrapper does the same). `path` is relative to
// /services/data/<version>.
async function salesforceFetch(path: string, init: { method?: string; body?: unknown; accept?: string } = {}): Promise<Response> {
  const call = (auth: { accessToken: string; instanceUrl: string }) => fetch(`https://${instanceHost(auth.instanceUrl)}/services/data/${SALESFORCE_API_VERSION}${path}`, {
    method: init.method || "GET",
    headers: { authorization: `Bearer ${auth.accessToken}`, "content-type": "application/json", accept: init.accept || "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(SALESFORCE_TIMEOUT_MS),
  });

  let auth = await ensureSalesforceTokenFresh();
  if (!auth) throw new SalesforceNotConnectedError();
  let response = await call(auth);
  if (response.status === 401) {
    auth = await ensureSalesforceTokenFresh({ forceIfTokenMatches: auth.accessToken });
    if (!auth) throw new SalesforceNotConnectedError();
    response = await call(auth);
  }
  return response;
}

// A file body (e.g. /sobjects/Attachment/<id>/Body), as bytes plus its content type.
export async function salesforceDownload(path: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await salesforceFetch(path, { accept: "*/*" });
  if (!response.ok) throw new Error(`Salesforce download failed (${response.status})`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "application/octet-stream" };
}

export async function salesforceApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await salesforceFetch(path, init);
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // Salesforce errors come back as [{ message, errorCode }].
    const first = Array.isArray(body) ? body[0] as { message?: string; errorCode?: string } : null;
    throw new Error(first?.message ? `Salesforce: ${first.message}` : `Salesforce request failed (${response.status})`);
  }
  return body as T;
}

export function isTokenStale(obtainedAt: Date | null, now = Date.now()) {
  return !obtainedAt || now - obtainedAt.getTime() > MAX_ACCESS_TOKEN_AGE_MS;
}

// The single choke point for refreshing the workspace token, ported from
// Sales AI's ensureGlobalSalesforceTokenFresh. A transaction-scoped
// Postgres advisory lock serializes it across the web service and every
// cron job, so only one call to Salesforce's token endpoint is ever in
// flight — with refresh-token rotation on, two racing refreshes would
// invalidate each other. Everyone else waits for the lock, then finds
// the token already fresh. Only a confirmed invalid_grant marks the
// connection expired; a timeout or 5xx leaves it alone so the next
// attempt can recover on its own. Returns null when there's no usable
// token: not connected, or just marked expired.
// `forceIfTokenMatches`: a caller that just got a 401 with this access
// token forces a refresh — unless another caller already replaced it.
export async function ensureSalesforceTokenFresh({ forceIfTokenMatches }: { forceIfTokenMatches?: string } = {}): Promise<{ accessToken: string; instanceUrl: string } | null> {
  return getDb().transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('task-ai:salesforce-token'))`);
    const [row] = await tx.select().from(salesforceConnection).where(eq(salesforceConnection.id, 1)).limit(1);
    if (!row?.refreshTokenEnc || !row.accessTokenEnc || !row.instanceUrl) return null;

    let accessToken: string, refreshToken: string;
    try {
      accessToken = decryptToken(row.accessTokenEnc);
      refreshToken = decryptToken(row.refreshTokenEnc);
    } catch {
      // Encrypted under a previous SESSION_SECRET — unusable until reconnected.
      await tx.update(salesforceConnection).set({ tokenStatus: "expired", updatedAt: new Date() }).where(eq(salesforceConnection.id, 1));
      return null;
    }

    const needsRefresh = forceIfTokenMatches ? accessToken === forceIfTokenMatches : isTokenStale(row.tokenObtainedAt);
    if (!needsRefresh) return { accessToken, instanceUrl: row.instanceUrl };

    try {
      const tokens = await refreshTokens(refreshToken, row.instanceUrl);
      await tx.update(salesforceConnection).set({ instanceUrl: tokens.instanceUrl, accessTokenEnc: encryptToken(tokens.accessToken), refreshTokenEnc: encryptToken(tokens.refreshToken), tokenObtainedAt: new Date(), tokenStatus: "active", updatedAt: new Date() }).where(eq(salesforceConnection.id, 1));
      return { accessToken: tokens.accessToken, instanceUrl: tokens.instanceUrl };
    } catch (error) {
      if (error instanceof SalesforceOAuthError && error.salesforceErrorCode === "invalid_grant") {
        await tx.update(salesforceConnection).set({ tokenStatus: "expired", updatedAt: new Date() }).where(eq(salesforceConnection.id, 1));
        // Commit the "expired" mark rather than roll it back with the throw.
        return null;
      }
      throw error;
    }
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { SALESFORCE_OAUTH_SCOPE, buildAuthorizeUrl, decryptToken, encryptToken, generatePkce, isTokenStale } from "../app/lib/salesforce";
import { isSalesforceHost, validateSalesforceDomain } from "../app/lib/salesforce-domain";
import { createHash } from "node:crypto";

process.env.SESSION_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";

test("validateSalesforceDomain accepts Salesforce login, sandbox and My Domain hosts", () => {
  for (const domain of ["login.salesforce.com", "test.salesforce.com", "acme.my.salesforce.com", "acme--uat.sandbox.my.salesforce.com", "acme.lightning.force.com"]) {
    assert.deepEqual(validateSalesforceDomain(domain), { valid: true, error: "" }, domain);
  }
});

test("validateSalesforceDomain rejects empty values, schemes, paths and malformed hosts with Sales AI's messages", () => {
  assert.match(validateSalesforceDomain("").error, /Enter a valid Salesforce domain/);
  assert.match(validateSalesforceDomain("https://login.salesforce.com").error, /Do not include http or https/);
  assert.match(validateSalesforceDomain("login.salesforce.com/services").error, /No paths or parameters/);
  assert.match(validateSalesforceDomain("login.salesforce.com?x=1").error, /No paths or parameters/);
  assert.match(validateSalesforceDomain("not a domain").error, /Enter a valid Salesforce domain/);
});

test("validateSalesforceDomain rejects hosts Salesforce doesn't own, since the client secret is posted to them", () => {
  for (const domain of ["evil.example", "salesforce.com.evil.example", "evilsalesforce.com", "login.salesforce.co"]) {
    assert.equal(validateSalesforceDomain(domain).valid, false, domain);
    assert.equal(isSalesforceHost(domain), false, domain);
  }
  assert.equal(isSalesforceHost("ACME.MY.SALESFORCE.COM"), true);
});

test("encryptToken round-trips, never contains the plaintext, and differs per call", () => {
  const first = encryptToken("00D-secret-token"), second = encryptToken("00D-secret-token");
  assert.ok(!first.includes("00D-secret-token"));
  assert.notEqual(first, second);
  assert.equal(decryptToken(first), "00D-secret-token");
  assert.equal(decryptToken(second), "00D-secret-token");
});

test("decryptToken rejects a tampered ciphertext and a token encrypted under a different SESSION_SECRET", () => {
  const stored = encryptToken("refresh-token");
  const [version, iv, tag, body] = stored.split(".");
  const flipped = body[0] === "A" ? `B${body.slice(1)}` : `A${body.slice(1)}`;
  assert.throws(() => decryptToken([version, iv, tag, flipped].join(".")));
  assert.throws(() => decryptToken("plaintext-token"));
  const original = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = "a-completely-different-secret-of-enough-length";
    assert.throws(() => decryptToken(stored));
  } finally { process.env.SESSION_SECRET = original; }
});

test("generatePkce returns an S256 challenge of its verifier", () => {
  const { verifier, challenge } = generatePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
});

test("buildAuthorizeUrl targets the chosen domain with code + PKCE + refresh_token scope", () => {
  const url = new URL(buildAuthorizeUrl({ domain: "acme.my.salesforce.com", clientId: "client-id", redirectUri: "https://tasks-ai.onrender.com/api/integrations/salesforce/callback", state: "state-1", challenge: "challenge-1" }));
  assert.equal(url.origin, "https://acme.my.salesforce.com");
  assert.equal(url.pathname, "/services/oauth2/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://tasks-ai.onrender.com/api/integrations/salesforce/callback");
  assert.equal(url.searchParams.get("scope"), SALESFORCE_OAUTH_SCOPE);
  assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "state-1");
});

test("isTokenStale treats a missing timestamp or one older than 30 minutes as stale", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(isTokenStale(null, now), true);
  assert.equal(isTokenStale(new Date(now - 29 * 60 * 1000), now), false);
  assert.equal(isTokenStale(new Date(now - 31 * 60 * 1000), now), true);
});

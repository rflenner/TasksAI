// Slack's own request-signing scheme — distinct from Resend/Svix's (see
// resend-webhook.ts): HMAC-SHA256 over "v0:{timestamp}:{raw body}", using
// the app's Signing Secret as the key, compared against the hex-encoded
// "v0=<hex>" X-Slack-Signature header. Raw body matters here — Next.js's
// own body-parsing helpers would re-serialize form data differently than
// the exact bytes Slack sent and signed, silently breaking verification —
// callers must pass the untouched string from request.text().
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySlackSignature(input: { secret: string; timestamp: string; body: string; signatureHeader: string }) {
  const expected = `v0=${createHmac("sha256", input.secret).update(`v0:${input.timestamp}:${input.body}`).digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(input.signatureHeader);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

// Same replay-protection convention as isFreshTimestamp in
// resend-webhook.ts — Slack's own recommendation is 5 minutes.
export function isFreshSlackTimestamp(timestamp: string, toleranceSeconds = 300) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && Math.abs(Date.now() / 1000 - seconds) <= toleranceSeconds;
}

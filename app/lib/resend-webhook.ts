import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs webhook deliveries the Svix way: base64(HMAC-SHA256(secret,
// `${id}.${timestamp}.${body}`)), compared against one or more "v1,<sig>"
// entries in the svix-signature header (space-separated, so a secret
// rotation can briefly carry two valid signatures).
export function verifyResendSignature(input: { secret: string; id: string; timestamp: string; body: string; signatureHeader: string }) {
  const secretBytes = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", secretBytes).update(`${input.id}.${input.timestamp}.${input.body}`).digest();
  return input.signatureHeader.split(" ").some(part => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const provided = Buffer.from(sig, "base64");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

// Rejects replayed webhook deliveries whose timestamp has drifted too far
// from now (either direction — clock skew, or a captured request replayed later).
export function isFreshTimestamp(timestamp: string, toleranceSeconds = 300) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  return Math.abs(Date.now() / 1000 - seconds) <= toleranceSeconds;
}

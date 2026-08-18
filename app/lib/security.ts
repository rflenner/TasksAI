import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

// Excludes 0/1/I/O to avoid ambiguity when a user types the code by hand.
// 32 chars, and 256 % 32 === 0, so byte % alphabet.length has no modulo bias.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomLoginCode(length = 8) {
  return Array.from(randomBytes(length), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return value;
}
export function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
export function signedValue(value: string) { return `${value}.${sign(value)}`; }
export function verifySignedValue(cookie: string | undefined) {
  if (!cookie) return null;
  const split = cookie.lastIndexOf(".");
  if (split < 1) return null;
  const value = cookie.slice(0, split), supplied = Buffer.from(cookie.slice(split + 1)), expected = Buffer.from(sign(value));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? value : null;
}
export function safeReturnTo(value: string | null) { return value?.startsWith("/") && !value.startsWith("//") ? value : "/"; }

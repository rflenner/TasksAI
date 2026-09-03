import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

// Excludes 0/1/I/O to avoid ambiguity when a user types the code by hand.
// 32 chars, and 256 % 32 === 0, so byte % alphabet.length has no modulo bias.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomLoginCode(length = 8) {
  return Array.from(randomBytes(length), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
// A temporary password a site admin generates and relays out of band (see
// db/schema.ts's passwordHash comment) — same unambiguous alphabet as a
// login code, just longer: 12 chars is 60 bits of entropy, plenty for
// something meant to be replaced with a stronger sign-in method soon
// after, not a permanent secret someone memorizes.
export function randomTempPassword() { return randomLoginCode(12); }

// scrypt, not sha256 — a password (unlike every other secret in this file)
// is chosen by a person and needs to survive an offline guessing attack
// against a stolen database dump, which a fast general-purpose hash like
// sha256 does nothing to slow down. No new dependency: node:crypto's own
// scrypt is a real, still-recommended password KDF, and every other
// credential in this app already goes through this same module.
const scryptAsync = promisify(scrypt);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false; // no password ever set for this account
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
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

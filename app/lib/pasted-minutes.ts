import { sha256 } from "./security";

// Normalized before hashing so trivial formatting differences (trailing
// whitespace, a stray blank line, extra spaces from a copy/paste) don't
// produce a different hash for what's really the same text — but not
// normalized so aggressively that two genuinely different pastes collide.
export function hashPastedMinutes(text: string): string {
  return sha256(text.trim().replace(/\s+/g, " "));
}

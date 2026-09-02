import assert from "node:assert/strict";
import test from "node:test";
import { hashPastedMinutes } from "../app/lib/pasted-minutes";

test("hashPastedMinutes: identical text always produces the same hash", () => {
  const text = "Rizan: let's review the playbooks with Pavneet before implementation.";
  assert.equal(hashPastedMinutes(text), hashPastedMinutes(text));
});

test("hashPastedMinutes: leading/trailing whitespace doesn't change the hash", () => {
  const text = "Same meeting notes here.";
  assert.equal(hashPastedMinutes(text), hashPastedMinutes(`  ${text}  \n\n`));
});

test("hashPastedMinutes: internal whitespace differences (extra spaces, line breaks) don't change the hash", () => {
  const a = "Line one.\nLine two.   Line three.";
  const b = "Line one. Line   two. Line three.";
  assert.equal(hashPastedMinutes(a), hashPastedMinutes(b));
});

test("hashPastedMinutes: genuinely different text produces a different hash", () => {
  assert.notEqual(hashPastedMinutes("Meeting notes A"), hashPastedMinutes("Meeting notes B"));
});

test("hashPastedMinutes: is a 64-char lowercase hex string (sha256)", () => {
  assert.match(hashPastedMinutes("anything"), /^[0-9a-f]{64}$/);
});

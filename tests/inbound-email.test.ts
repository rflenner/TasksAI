import assert from "node:assert/strict";
import test from "node:test";
import { bareEmail, stripHtml } from "../app/lib/inbound-email";

test("bareEmail extracts the address out of a \"Name <address>\" header, unchanged case-folded", () => {
  assert.equal(bareEmail("Rajat Budania <Rajat@HabileLabs.io>"), "rajat@habilelabs.io");
  assert.equal(bareEmail("  Rizan Flenner  <rizan@iseeit.com>  "), "rizan@iseeit.com");
});

test("bareEmail passes a bare address through as-is, just trimmed and lowercased", () => {
  assert.equal(bareEmail("onboarding@resend.dev"), "onboarding@resend.dev");
  assert.equal(bareEmail("  Rizan@ISEEit.com  "), "rizan@iseeit.com");
});

test("stripHtml drops tags/style/script and collapses whitespace to plain readable text", () => {
  const html = "<html><head><style>.x{color:red}</style></head><body><p>Please <b>review</b> the&nbsp;proposal.</p><script>track()</script></body></html>";
  assert.equal(stripHtml(html), "Please review the proposal.");
});

test("stripHtml handles text with no markup at all", () => {
  assert.equal(stripHtml("just plain text"), "just plain text");
});

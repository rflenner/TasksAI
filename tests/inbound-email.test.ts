import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessDays, bareEmail, extractEmailNameHints, resolveViaEmailHint, stripHtml } from "../app/lib/inbound-email";

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

test("extractEmailNameHints finds \"Name <email>\" pairs from quoted From/To/Cc header lines", () => {
  const text = `Subject: Re: Team meeting\n\nFrom: Xenofon Kanarios <xenofon@iseeit.com>\nTo: Rizan Flenner <rizan@iseeit.com>\n\nHi Rizan, here are my notes.`;
  const hints = extractEmailNameHints(text);
  assert.equal(hints.get("xenofon kanarios"), "xenofon@iseeit.com");
  assert.equal(hints.get("rizan flenner"), "rizan@iseeit.com");
  assert.equal(hints.size, 2);
});

test("extractEmailNameHints lowercases the header name key and the email, and trims stray quotes", () => {
  const hints = extractEmailNameHints(`From: "Maya Chen" <Maya.Chen@Example.COM>`);
  assert.equal(hints.get("maya chen"), "maya.chen@example.com");
});

test("extractEmailNameHints returns an empty map when there's no \"Name <email>\" shape in the text at all", () => {
  assert.equal(extractEmailNameHints("just some plain prose about a meeting, no headers here").size, 0);
});

test("resolveViaEmailHint matches the exact header name, case-insensitively", () => {
  const hints = new Map([["xenofon kanarios", "Xenofon Kanarios"]]);
  assert.equal(resolveViaEmailHint("Xenofon Kanarios", hints), "Xenofon Kanarios");
  assert.equal(resolveViaEmailHint("  xenofon KANARIOS  ", hints), "Xenofon Kanarios");
});

test("resolveViaEmailHint matches a bare first name against a hint's first word — the actual bug this fixes: the AI extracted \"Xenophon\" (spelled differently) while the email's own header spelled it \"Xenofon\"", () => {
  const hints = new Map([["xenofon kanarios", "Xenofon Kanarios"]]);
  assert.equal(resolveViaEmailHint("Xenofon", hints), "Xenofon Kanarios");
});

test("resolveViaEmailHint returns null for a name with no matching hint, and for empty input", () => {
  const hints = new Map([["xenofon kanarios", "Xenofon Kanarios"]]);
  assert.equal(resolveViaEmailHint("Someone Else", hints), null);
  assert.equal(resolveViaEmailHint("", hints), null);
});

// 2024-01-01 is a known Monday — used as a fixed anchor so these tests
// don't depend on what "today" happens to be when they run.
test("addBusinessDays counts only Mon-Fri, from a Monday reference", () => {
  assert.equal(addBusinessDays("2024-01-01", 1), "2024-01-02"); // Tue
  assert.equal(addBusinessDays("2024-01-01", 3), "2024-01-04"); // Thu
  assert.equal(addBusinessDays("2024-01-01", 5), "2024-01-08"); // following Mon — skips the weekend
});

test("addBusinessDays skips the weekend when it falls in the middle of the count, from a Friday reference", () => {
  assert.equal(addBusinessDays("2024-01-05", 1), "2024-01-08"); // Fri -> Mon, not Sat
  assert.equal(addBusinessDays("2024-01-05", 3), "2024-01-10"); // Mon, Tue, Wed
});

test("addBusinessDays still lands on a weekday even when the reference date itself is a weekend", () => {
  assert.equal(addBusinessDays("2024-01-06", 1), "2024-01-08"); // Sat reference -> first business day is Mon, skipping Sunday too
});

test("addBusinessDays only reads the date portion, ignoring any time/offset already on the reference string", () => {
  assert.equal(addBusinessDays("2024-01-01T23:59:59.999Z", 1), "2024-01-02");
});

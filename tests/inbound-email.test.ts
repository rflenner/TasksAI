import assert from "node:assert/strict";
import test from "node:test";
import { addressDomain, bareEmail, extractEmailNameHints, findReplyToken, inboundEmailDomain, isAddressedToDomain, recipientAddresses, resolveViaEmailHint, stripHtml, stripQuotedReply } from "../app/lib/inbound-email";

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

test("stripQuotedReply cuts at Gmail/Apple Mail's \"On ... wrote:\" line", () => {
  const text = "Still on track, will have it by Friday.\n\nOn Mon, Sep 15, 2026 at 9:00 AM Rizan Flenner <rizan@iseeit.com> wrote:\n> Just a reminder about this task.\n> Please let me know if you're still on track.";
  assert.equal(stripQuotedReply(text), "Still on track, will have it by Friday.");
});

test("stripQuotedReply cuts at Outlook's \"-----Original Message-----\" line", () => {
  const text = "Done, closing this out.\n\n-----Original Message-----\nFrom: Rizan Flenner\nSent: Tuesday, September 15, 2026\nTo: Shankar Morwal\nSubject: Prepare Sales AI roadmap";
  assert.equal(stripQuotedReply(text), "Done, closing this out.");
});

test("stripQuotedReply cuts at Outlook's unmarked \"From: / Sent: / To:\" quote block", () => {
  const text = "I'll take a look today.\n\nFrom: Rizan Flenner\nSent: Tuesday, September 15, 2026 9:00 AM\nTo: Shankar Morwal\nSubject: Prepare Sales AI roadmap\n\nJust a reminder.";
  assert.equal(stripQuotedReply(text), "I'll take a look today.");
});

test("stripQuotedReply cuts at a run of \">\"-quoted lines even with no header line at all", () => {
  const text = "Sounds good.\n\n> Just a reminder about this task.\n> Please let me know.";
  assert.equal(stripQuotedReply(text), "Sounds good.");
});

test("stripQuotedReply returns the whole trimmed text when there's nothing quoted to strip", () => {
  assert.equal(stripQuotedReply("  Already sent it over, thanks!  "), "Already sent it over, thanks!");
});

test("findReplyToken picks the reply+{token}@ address out of a \"to\" list alongside other recipients", () => {
  const to = ["Rizan Flenner <rizan@iseeit.com>", "reply+925dba35ca64a7f3@tasks.iseeit.ai"];
  assert.equal(findReplyToken(to), "925dba35ca64a7f3");
});

test("findReplyToken matches a bare reply+ address with no display name, case-insensitively", () => {
  assert.equal(findReplyToken(["REPLY+ABCDEF01@tasks.iseeit.ai"]), "abcdef01");
});

test("findReplyToken returns null when no \"to\" address is a reply+ address", () => {
  assert.equal(findReplyToken(["tasks@tasks.iseeit.ai", "Someone Else <someone@example.com>"]), null);
});

test("findReplyToken returns null for an empty \"to\" list", () => {
  assert.equal(findReplyToken([]), null);
});

// ---- Which mail is this app's to handle (the 2026-10-14 gofibu mix-up) ----

test("addressDomain: the domain of a bare or \"Name <address>\" address, lower-cased; empty when there isn't one", () => {
  assert.equal(addressDomain("RE-Flenner@Belege.Gofibu.at"), "belege.gofibu.at");
  assert.equal(addressDomain("Rizan Flenner <rizan@iseeit.com>"), "iseeit.com");
  assert.equal(addressDomain("not-an-address"), "");
  assert.equal(addressDomain(""), "");
});

test("isAddressedToDomain: mail to this app's domain is ours, mail to another domain on the same Resend account is not", () => {
  assert.equal(isAddressedToDomain(["tasks@tasks.iseeit.ai"], "tasks.iseeit.ai"), true);
  assert.equal(isAddressedToDomain(["Task AI <Tasks@Tasks.iSEEit.ai>"], "tasks.iseeit.ai"), true);
  assert.equal(isAddressedToDomain(["re-flenner@belege.gofibu.at"], "tasks.iseeit.ai"), false);
});

test("isAddressedToDomain: one recipient of ours among others is enough; lookalike domains are not ours", () => {
  assert.equal(isAddressedToDomain(["colleague@example.com", "tasks@tasks.iseeit.ai"], "tasks.iseeit.ai"), true);
  assert.equal(isAddressedToDomain(["x@tasks.iseeit.ai.evil.com"], "tasks.iseeit.ai"), false);
  assert.equal(isAddressedToDomain(["x@evil-tasks.iseeit.ai"], "tasks.iseeit.ai"), false);
  assert.equal(isAddressedToDomain(["x@sub.tasks.iseeit.ai"], "tasks.iseeit.ai"), false);
});

test("isAddressedToDomain: no recipients, or no domain configured, is never ours", () => {
  assert.equal(isAddressedToDomain([], "tasks.iseeit.ai"), false);
  assert.equal(isAddressedToDomain(["tasks@tasks.iseeit.ai"], ""), false);
});

test("recipientAddresses: collects to, cc and bcc, accepting an array or a single string, and skips junk", () => {
  assert.deepEqual(recipientAddresses({ to: ["a@x.com"], cc: "b@y.com", bcc: ["c@z.com", 42, ""] }), ["a@x.com", "b@y.com", "c@z.com"]);
  assert.deepEqual(recipientAddresses({ to: "only@x.com" }), ["only@x.com"]);
  assert.deepEqual(recipientAddresses(undefined), []);
  assert.deepEqual(recipientAddresses({}), []);
});

test("recipientAddresses + isAddressedToDomain: a forward that reaches this app only through cc still counts", () => {
  const recipients = recipientAddresses({ to: ["boss@example.com"], cc: ["tasks@tasks.iseeit.ai"] });
  assert.equal(isAddressedToDomain(recipients, "tasks.iseeit.ai"), true);
});

test("inboundEmailDomain: INBOUND_EMAIL_DOMAIN wins (trimmed, lower-cased), otherwise the documented default", () => {
  const before = process.env.INBOUND_EMAIL_DOMAIN;
  try {
    delete process.env.INBOUND_EMAIL_DOMAIN;
    assert.equal(inboundEmailDomain(), "tasks.iseeit.ai");
    process.env.INBOUND_EMAIL_DOMAIN = "  Inbox.Example.COM ";
    assert.equal(inboundEmailDomain(), "inbox.example.com");
  } finally {
    if (before === undefined) delete process.env.INBOUND_EMAIL_DOMAIN; else process.env.INBOUND_EMAIL_DOMAIN = before;
  }
});

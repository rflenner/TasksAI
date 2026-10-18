import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULES, emailFromUnsubscribeToken, isValidEmail, mayEmail, normalizeEmail, sanitizeRules, unsubscribeToken } from "../app/lib/close-plan-notify-rules";

test("rules fall back to the agreed defaults and stay in range", () => {
  assert.deepEqual(sanitizeRules(undefined), DEFAULT_RULES);
  assert.deepEqual(sanitizeRules("junk"), DEFAULT_RULES);
  const r = sanitizeRules({ invitation: { email: false, reminderAfterDays: 999, maxReminders: -3 }, overdue: { internalEveryDays: 0 }, customerEmailCapPerWeek: 50, digest: { monday: "yes" } });
  assert.equal(r.invitation.email, false);
  assert.equal(r.invitation.reminderAfterDays, 30);
  assert.equal(r.invitation.maxReminders, 0);
  assert.equal(r.overdue.internalEveryDays, 1);
  assert.equal(r.customerEmailCapPerWeek, 7);
  assert.equal(r.digest.monday, DEFAULT_RULES.digest.monday, "a non-boolean keeps the default");
  assert.equal(r.assignment.internalEmail, true);
});

test("the defaults follow what was agreed: customers never get more than one scheduled email a week, iSEEit people get overdue reminders every two days", () => {
  assert.equal(DEFAULT_RULES.customerEmailCapPerWeek, 1);
  assert.equal(DEFAULT_RULES.overdue.internalEveryDays, 2);
  assert.equal(DEFAULT_RULES.overdue.customersInMondayDigest, true);
  assert.equal(DEFAULT_RULES.requestedBy.customersInDigest, true);
});

test("unsubscribe tokens only work for the address they were made for", () => {
  process.env.SESSION_SECRET = "test-secret-for-unsubscribe-tokens";
  const t = unsubscribeToken("Kelly@Cluepoints.com ");
  assert.equal(emailFromUnsubscribeToken(t), "kelly@cluepoints.com");
  assert.equal(emailFromUnsubscribeToken(t + "x"), null);
  const [, sig] = t.split(".");
  assert.equal(emailFromUnsubscribeToken(`${Buffer.from("other@x.com").toString("base64url")}.${sig}`), null);
  assert.equal(emailFromUnsubscribeToken("nonsense"), null);
});

test("people who opted out are skipped, case-insensitively", () => {
  const out = new Set([normalizeEmail("Gary@Cust.com")]);
  assert.equal(mayEmail("gary@cust.com", out), false);
  assert.equal(mayEmail("erik@cust.com", out), true);
  assert.equal(mayEmail("not-an-email", out), false);
  assert.equal(isValidEmail("a@b.co"), true);
});

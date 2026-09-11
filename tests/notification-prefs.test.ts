import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTIFICATION_PREFS, resolvePrefs, wantsEmail, wantsSlack } from "../app/lib/notification-prefs";

test("wantsEmail: true for 'email' and 'both', false for 'slack' and 'off'", () => {
  assert.equal(wantsEmail("email"), true);
  assert.equal(wantsEmail("both"), true);
  assert.equal(wantsEmail("slack"), false);
  assert.equal(wantsEmail("off"), false);
});

test("wantsSlack: true for 'slack' and 'both', false for 'email' and 'off'", () => {
  assert.equal(wantsSlack("slack"), true);
  assert.equal(wantsSlack("both"), true);
  assert.equal(wantsSlack("email"), false);
  assert.equal(wantsSlack("off"), false);
});

test("resolvePrefs: null (never set) falls back to the full default", () => {
  assert.deepEqual(resolvePrefs(null), DEFAULT_NOTIFICATION_PREFS);
});

test("resolvePrefs: undefined falls back to the full default", () => {
  assert.deepEqual(resolvePrefs(undefined), DEFAULT_NOTIFICATION_PREFS);
});

test("resolvePrefs: a stored value overrides only the fields it sets, defaults fill the rest", () => {
  const resolved = resolvePrefs({ overdue: "off" });
  assert.equal(resolved.overdue, "off");
  assert.equal(resolved.newAssignment, DEFAULT_NOTIFICATION_PREFS.newAssignment);
  assert.equal(resolved.weeklyDigest, DEFAULT_NOTIFICATION_PREFS.weeklyDigest);
  assert.equal(resolved.statusUpdateSlack, DEFAULT_NOTIFICATION_PREFS.statusUpdateSlack);
});

test("resolvePrefs: a fully-specified stored value passes through unchanged", () => {
  const stored = { newAssignment: "email", overdue: "off", weeklyDigest: "slack", statusUpdateSlack: false } as const;
  assert.deepEqual(resolvePrefs(stored), stored);
});

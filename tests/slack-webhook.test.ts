import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { isFreshSlackTimestamp, verifySlackSignature } from "../app/lib/slack-webhook";

const secret = "test-signing-secret";
const sign = (timestamp: string, body: string) => `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

test("verifySlackSignature accepts a correctly signed payload", () => {
  const timestamp = String(Math.floor(Date.now() / 1000)), body = "command=%2Ftask&text=hello";
  assert.equal(verifySlackSignature({ secret, timestamp, body, signatureHeader: sign(timestamp, body) }), true);
});

test("verifySlackSignature rejects a tampered body, wrong secret, or mismatched timestamp", () => {
  const timestamp = String(Math.floor(Date.now() / 1000)), body = "command=%2Ftask&text=hello";
  const goodSig = sign(timestamp, body);
  assert.equal(verifySlackSignature({ secret, timestamp, body: "command=%2Ftask&text=goodbye", signatureHeader: goodSig }), false);
  assert.equal(verifySlackSignature({ secret: "wrong-secret", timestamp, body, signatureHeader: goodSig }), false);
  assert.equal(verifySlackSignature({ secret, timestamp: String(Number(timestamp) + 1), body, signatureHeader: goodSig }), false);
});

test("verifySlackSignature rejects a signature of the wrong length outright, never throws", () => {
  const timestamp = String(Math.floor(Date.now() / 1000)), body = "command=%2Ftask";
  assert.equal(verifySlackSignature({ secret, timestamp, body, signatureHeader: "v0=short" }), false);
});

test("isFreshSlackTimestamp accepts now and rejects far past/future or non-numeric", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(isFreshSlackTimestamp(String(now)), true);
  assert.equal(isFreshSlackTimestamp(String(now - 3600)), false);
  assert.equal(isFreshSlackTimestamp(String(now + 3600)), false);
  assert.equal(isFreshSlackTimestamp("not-a-number"), false);
});

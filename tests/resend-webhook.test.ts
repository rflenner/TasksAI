import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { isFreshTimestamp, verifyResendSignature } from "../app/lib/resend-webhook";

const secret = "whsec_" + Buffer.from("test-signing-secret-bytes").toString("base64");
const sign = (id: string, timestamp: string, body: string) => {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
};

test("verifyResendSignature accepts a correctly signed payload", () => {
  const id = "msg_1", timestamp = String(Math.floor(Date.now() / 1000)), body = JSON.stringify({ type: "email.bounced" });
  assert.equal(verifyResendSignature({ secret, id, timestamp, body, signatureHeader: sign(id, timestamp, body) }), true);
});

test("verifyResendSignature rejects a tampered body or wrong secret", () => {
  const id = "msg_1", timestamp = String(Math.floor(Date.now() / 1000)), body = JSON.stringify({ type: "email.bounced" });
  const goodSig = sign(id, timestamp, body);
  assert.equal(verifyResendSignature({ secret, id, timestamp, body: JSON.stringify({ type: "email.delivered" }), signatureHeader: goodSig }), false);
  assert.equal(verifyResendSignature({ secret: "whsec_" + Buffer.from("wrong-secret").toString("base64"), id, timestamp, body, signatureHeader: goodSig }), false);
});

test("verifyResendSignature accepts when any entry in a multi-value header matches (secret rotation)", () => {
  const id = "msg_1", timestamp = String(Math.floor(Date.now() / 1000)), body = "{}";
  assert.equal(verifyResendSignature({ secret, id, timestamp, body, signatureHeader: `v1,bm90YXNpZw== ${sign(id, timestamp, body)}` }), true);
});

test("isFreshTimestamp accepts now and rejects far past/future", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(isFreshTimestamp(String(now)), true);
  assert.equal(isFreshTimestamp(String(now - 3600)), false);
  assert.equal(isFreshTimestamp(String(now + 3600)), false);
  assert.equal(isFreshTimestamp("not-a-number"), false);
});

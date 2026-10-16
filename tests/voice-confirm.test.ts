import assert from "node:assert/strict";
import test from "node:test";
import { interpretConfirmReply } from "../app/lib/voice-confirm";

test("interpretConfirmReply: a clean yes — with at most a few filler words — confirms", () => {
  assert.equal(interpretConfirmReply("Yes").decision, "yes");
  assert.equal(interpretConfirmReply("yeah, go ahead").decision, "yes");
  assert.equal(interpretConfirmReply("Yes please send it").decision, "yes");
});

test("interpretConfirmReply: a yes that carries more to say is a new request, never a go-ahead for the original", () => {
  const reply = interpretConfirmReply("Yes, but tell him I need the numbers by Friday instead");
  assert.equal(reply.decision, "other");
  assert.equal(reply.newRequest, "Yes, but tell him I need the numbers by Friday instead");
});

test("interpretConfirmReply: a bare no cancels with nothing to carry over", () => {
  assert.deepEqual(interpretConfirmReply("No"), { decision: "no", newRequest: null });
  assert.deepEqual(interpretConfirmReply("no, cancel that"), { decision: "no", newRequest: null });
  assert.deepEqual(interpretConfirmReply("Never mind."), { decision: "no", newRequest: null });
});

test("interpretConfirmReply: 'no' plus a real new instruction hands the instruction back (the live-session loss)", () => {
  const reply = interpretConfirmReply("No, can you send a notification to Xenofon?");
  assert.equal(reply.decision, "no");
  assert.equal(reply.newRequest, "can you send a notification to Xenofon?");
});

test("interpretConfirmReply: something that is neither yes nor no is handed back whole as a new request", () => {
  const text = "Shankar has sent the presentation, but we need to follow up on pricing";
  const reply = interpretConfirmReply(text);
  assert.equal(reply.decision, "other");
  assert.equal(reply.newRequest, text);
});

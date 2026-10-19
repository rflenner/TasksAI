import assert from "node:assert/strict";
import test from "node:test";
import { garbledTracker, isGarbled, noiseFloorDb } from "../app/components/voice-noise";
import { audioInputSettings, parseListeningMode } from "../app/lib/voice-audio";

test("noiseFloorDb: needs enough samples, ignores the person talking", () => {
  assert.equal(noiseFloorDb([-30, -30]), null);
  const quietRoomWithSpeech = [...Array(30).fill(-60), ...Array(20).fill(-20)];
  assert.ok(noiseFloorDb(quietRoomWithSpeech)! < -48);
  assert.ok(noiseFloorDb(Array(50).fill(-35))! > -48);
});

test("isGarbled / garbledTracker: three unintelligible bits inside 45 s", () => {
  assert.equal(isGarbled(""), true); assert.equal(isGarbled("uh"), true); assert.equal(isGarbled("what is due"), false);
  const t = garbledTracker();
  assert.equal(t.note(0), false); assert.equal(t.note(10000), false); assert.equal(t.note(20000), true);
  const slow = garbledTracker();
  assert.equal(slow.note(0), false); assert.equal(slow.note(40000), false); assert.equal(slow.note(80000), false);
});

test("listening profiles: noisy is stricter than normal", () => {
  assert.equal(parseListeningMode("noisy"), "noisy"); assert.equal(parseListeningMode("x"), "normal");
  const n = audioInputSettings("noisy"), q = audioInputSettings("normal");
  assert.ok(n.turn_detection.threshold > q.turn_detection.threshold);
  assert.equal(n.noise_reduction.type, "far_field");
});

import { parseAuditFilters, sessionPlanName, sessionSurface } from "../app/lib/voice-audit";

test("audit: Close Plan sessions are told apart and named", () => {
  const cp = { events: [{ detail: {} }, { detail: { surface: "close_plan", planName: "Meridian Biotech" } }] };
  assert.equal(sessionSurface(cp), "close_plan"); assert.equal(sessionPlanName(cp), "Meridian Biotech");
  assert.equal(sessionSurface({ events: [{ detail: {} }] }), "task_ai");
  assert.equal(parseAuditFilters({ surface: "close_plan" }).surface, "close_plan");
  assert.equal(parseAuditFilters({ surface: "zzz" }).surface, "all");
});

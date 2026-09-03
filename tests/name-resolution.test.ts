import assert from "node:assert/strict";
import test from "node:test";
import { resolveRegisteredName, resolveTaskNames } from "../app/lib/name-resolution";

const registered = ["Xenofon Papadopoulos", "Shankar Iyer", "Drew Halloran", "Ada Lovelace"];

test("resolveRegisteredName matches a bare first name to the one registered user who has it", () => {
  assert.equal(resolveRegisteredName("Xenofon", registered), "Xenofon Papadopoulos");
  assert.equal(resolveRegisteredName("shankar", registered), "Shankar Iyer", "case-insensitive");
});

test("resolveRegisteredName matches an exact full name regardless of case, and trims either side", () => {
  assert.equal(resolveRegisteredName("  drew halloran  ", registered), "Drew Halloran");
});

test("resolveRegisteredName leaves an ambiguous first name (shared by two registered users) exactly as spoken, rather than guessing", () => {
  const twoAdas = [...registered, "Ada Chen"];
  assert.equal(resolveRegisteredName("Ada", twoAdas), "Ada");
});

test("resolveRegisteredName leaves a genuinely new name (no registered candidate at all) untouched", () => {
  assert.equal(resolveRegisteredName("Someone Outside", registered), "Someone Outside");
});

test("resolveRegisteredName returns an empty/whitespace-only input trimmed, without matching anything", () => {
  assert.equal(resolveRegisteredName("   ", registered), "");
});

test("resolveTaskNames resolves owner, collaborators, and recipients independently, and never touches a null/absent owner", () => {
  const resolved = resolveTaskNames({ owner: "Xenofon", collaborators: ["Shankar"], recipients: ["Drew", "someone new"] }, registered);
  assert.deepEqual(resolved, { owner: "Xenofon Papadopoulos", collaborators: ["Shankar Iyer"], recipients: ["Drew Halloran", "someone new"] });
  assert.equal(resolveTaskNames({ owner: null }, registered).owner, null);
  assert.equal(resolveTaskNames({}, registered).collaborators.length, 0, "a missing collaborators array resolves to an empty array, not undefined or a crash");
});

import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateSuggestions, levenshtein } from "../app/lib/duplicate-match";

test("levenshtein: identical strings are 0, a single substitution/insertion/deletion is 1", () => {
  assert.equal(levenshtein("drew", "drew"), 0);
  assert.equal(levenshtein("drew", "drewx"), 1);
  assert.equal(levenshtein("pavneet", "pavniet"), 1);
  assert.equal(levenshtein("", "abc"), 3);
});

test("findDuplicateSuggestions: person — a bare first name and someone's full name starting with it are flagged", () => {
  const suggestions = findDuplicateSuggestions("person", ["Drew", "Drew Klein", "Ayleen"]);
  assert.equal(suggestions.length, 1);
  assert.deepEqual([suggestions[0].a, suggestions[0].b], ["Drew", "Drew Klein"]);
});

test("findDuplicateSuggestions: person — two different full names that merely share a first word are never flagged", () => {
  assert.deepEqual(findDuplicateSuggestions("person", ["Pavneet Saluja", "Pavneet Kumar"]), []);
});

test("findDuplicateSuggestions: a same-length one-character typo is flagged (Pavneet vs Pavniet)", () => {
  const suggestions = findDuplicateSuggestions("person", ["Pavneet Saluja", "Pavniet Saluja"]);
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0].reason, /typo/);
});

test("findDuplicateSuggestions: same name in different capitalization is flagged with its own reason", () => {
  const suggestions = findDuplicateSuggestions("project", ["Pilot", "pilot"]);
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0].reason, /capitalization/);
});

test("findDuplicateSuggestions: unrelated names are never flagged", () => {
  assert.deepEqual(findDuplicateSuggestions("person", ["Ada Lovelace", "Drew Klein", "Rizan Flenner"]), []);
});

test("findDuplicateSuggestions: short unrelated words under the length floor are never flagged, even one edit apart", () => {
  assert.deepEqual(findDuplicateSuggestions("person", ["Sam", "Pam"]), []);
});

test("findDuplicateSuggestions: the first-word rule only applies to person, not project/meeting/topic", () => {
  assert.deepEqual(findDuplicateSuggestions("project", ["Pilot", "Pilot Rollout"]), []);
});

test("findDuplicateSuggestions: blank/whitespace-only values never match anything", () => {
  assert.deepEqual(findDuplicateSuggestions("person", ["", "Drew Klein"]), []);
});

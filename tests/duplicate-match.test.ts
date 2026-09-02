import assert from "node:assert/strict";
import test from "node:test";
import { candidatesFor, findDuplicateSuggestions, levenshtein } from "../app/lib/duplicate-match";

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

test("candidatesFor: returns the other side of every matching pair for the given value, not both sides", () => {
  const candidates = candidatesFor("person", "Drew", ["Drew Klein", "Ayleen", "Rizan Flenner"]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].value, "Drew Klein");
  assert.match(candidates[0].reason, /short form/);
});

test("candidatesFor: no matches returns an empty array, not a crash", () => {
  assert.deepEqual(candidatesFor("person", "Rizan Flenner", ["Ayleen", "Drew Klein"]), []);
});

test("candidatesFor: multiple genuine candidates are all returned", () => {
  const candidates = candidatesFor("person", "Pavneet", ["Pavneet Saluja", "Pavneet Kumar", "Ayleen"]);
  assert.deepEqual(candidates.map(c => c.value).sort(), ["Pavneet Kumar", "Pavneet Saluja"]);
});

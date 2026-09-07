import assert from "node:assert/strict";
import test from "node:test";
import { splitIntoSpeechChunks } from "../app/lib/speech-chunks";

test("splitIntoSpeechChunks splits a multi-sentence walk read-out into one chunk per sentence", () => {
  const text = "Send updated pilot proposal. Draft covering pricing and timeline. Due Wednesday, September 16th. What do you want me to do?";
  assert.deepEqual(splitIntoSpeechChunks(text), [
    "Send updated pilot proposal.",
    "Draft covering pricing and timeline.",
    "Due Wednesday, September 16th.",
    "What do you want me to do?",
  ]);
});

test("splitIntoSpeechChunks returns a single chunk for a single-sentence answer", () => {
  assert.deepEqual(splitIntoSpeechChunks("Showing 41 tasks you own that are overdue."), ["Showing 41 tasks you own that are overdue."]);
});

test("splitIntoSpeechChunks keeps a trailing fragment with no terminal punctuation as its own chunk", () => {
  assert.deepEqual(splitIntoSpeechChunks("Added the update. Status moved to In progress"), ["Added the update.", "Status moved to In progress"]);
});

test("splitIntoSpeechChunks tolerates multiple spaces and mixed sentence terminators between sentences", () => {
  assert.deepEqual(splitIntoSpeechChunks("Marked it Closed!  Are you sure?   Yes."), ["Marked it Closed!", "Are you sure?", "Yes."]);
});

test("splitIntoSpeechChunks returns an empty array for empty or whitespace-only text", () => {
  assert.deepEqual(splitIntoSpeechChunks(""), []);
  assert.deepEqual(splitIntoSpeechChunks("   "), []);
});

test("splitIntoSpeechChunks with text that has no sentence-ending punctuation at all returns it as one chunk", () => {
  assert.deepEqual(splitIntoSpeechChunks("Opening a new action item"), ["Opening a new action item"]);
});

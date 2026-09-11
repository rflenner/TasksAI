import assert from "node:assert/strict";
import test from "node:test";
import { buildDigestBlocks, type DigestLine } from "../app/lib/slack";

function textOf(block: unknown): string {
  return (block as { text: { text: string } }).text.text;
}

test("buildDigestBlocks: intro is always the first block", () => {
  const blocks = buildDigestBlocks("3 tasks due this week", [{ lines: [{ subject: "Ship the thing", taskId: 1 }] }]);
  assert.equal(textOf(blocks[0]), "3 tasks due this week");
});

test("buildDigestBlocks: a line with an updateUrl renders as a Slack mrkdwn link", () => {
  const blocks = buildDigestBlocks("intro", [{ lines: [{ subject: "Ship the thing", taskId: 42, due: "2026-09-20", updateUrl: "https://example.com/u/abc" }] }]);
  assert.equal(textOf(blocks[1]), "• <https://example.com/u/abc|#42 Ship the thing> — Due 2026-09-20");
});

test("buildDigestBlocks: a line with no updateUrl still renders, just without a link", () => {
  const blocks = buildDigestBlocks("intro", [{ lines: [{ subject: "No link yet", taskId: 7 }] }]);
  assert.equal(textOf(blocks[1]), "• #7 No link yet — No due date");
});

test("buildDigestBlocks: overdue takes precedence over a due date in the detail text", () => {
  const blocks = buildDigestBlocks("intro", [{ lines: [{ subject: "Late", taskId: 1, due: "2026-08-01", overdue: true }] }]);
  assert.equal(textOf(blocks[1]), "• #1 Late — Overdue");
});

test("buildDigestBlocks: a closed task shows its close date instead of due/overdue", () => {
  const blocks = buildDigestBlocks("intro", [{ lines: [{ subject: "Done", taskId: 1, status: "Closed", closedAt: "2026-09-10" }] }]);
  assert.equal(textOf(blocks[1]), "• #1 Done — Closed · 2026-09-10");
});

test("buildDigestBlocks: an empty section is skipped entirely, including its heading", () => {
  const blocks = buildDigestBlocks("intro", [{ heading: "My tasks", lines: [] }, { heading: "Delegated", lines: [{ subject: "X", taskId: 1 } as DigestLine] }]);
  // intro + "Delegated" heading + its one line — no "My tasks" heading or block at all
  assert.equal(blocks.length, 3);
  assert.equal(textOf(blocks[1]), "*Delegated*");
  assert.equal(textOf(blocks[2]), "• #1 X — No due date");
});

test("buildDigestBlocks: a heading renders as its own bolded block before that section's lines", () => {
  const blocks = buildDigestBlocks("intro", [{ heading: "Overdue", lines: [{ subject: "X", taskId: 1 } as DigestLine] }]);
  assert.equal(textOf(blocks[1]), "*Overdue*");
  assert.equal(textOf(blocks[2]), "• #1 X — No due date");
});

test("buildDigestBlocks: more than 10 lines in one section are chunked into multiple blocks", () => {
  const lines: DigestLine[] = Array.from({ length: 12 }, (_, i) => ({ subject: `Task ${i}`, taskId: i }));
  const blocks = buildDigestBlocks("intro", [{ lines }]);
  // intro + 2 chunks (10 + 2)
  assert.equal(blocks.length, 3);
  assert.equal(textOf(blocks[1]).split("\n").length, 10);
  assert.equal(textOf(blocks[2]).split("\n").length, 2);
});

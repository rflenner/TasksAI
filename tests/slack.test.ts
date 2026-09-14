import assert from "node:assert/strict";
import test from "node:test";
import { buildDigestBlocks, buildEditTaskModal, type DigestLine } from "../app/lib/slack";

function textOf(block: unknown): string {
  return (block as { text: { text: string } }).text.text;
}

type ModalInputBlock = { block_id: string; optional?: boolean; element: Record<string, unknown> };

function inputBlocks(view: unknown): ModalInputBlock[] {
  return ((view as { blocks: unknown[] }).blocks as ModalInputBlock[]).filter(b => "block_id" in b && b.block_id !== undefined);
}
function byId(view: unknown, blockId: string): ModalInputBlock {
  const found = inputBlocks(view).find(b => b.block_id === blockId);
  assert.ok(found, `expected a block with block_id "${blockId}"`);
  return found;
}

test("buildEditTaskModal: private_metadata round-trips taskId, responseUrl, and source", () => {
  const view = buildEditTaskModal({ id: 42, subject: "Ship it", status: "Open", due: null, owner: "Maya Chen" }, "https://hooks.slack.com/actions/abc", "digest");
  const meta = JSON.parse((view as { private_metadata: string }).private_metadata);
  assert.deepEqual(meta, { taskId: 42, responseUrl: "https://hooks.slack.com/actions/abc", source: "digest" });
});

test("buildEditTaskModal: status select is pre-filled with the task's current status", () => {
  const view = buildEditTaskModal({ id: 1, subject: "X", status: "In progress", due: null, owner: "Y" }, "url", "card");
  const status = byId(view, "status_block").element as { initial_option: { value: string } };
  assert.equal(status.initial_option.value, "In progress");
});

test("buildEditTaskModal: due date is pre-filled when the task has one, omitted when it doesn't", () => {
  const withDue = byId(buildEditTaskModal({ id: 1, subject: "X", status: "Open", due: "2026-09-20", owner: "Y" }, "url", "card"), "due_block").element as { initial_date?: string };
  assert.equal(withDue.initial_date, "2026-09-20");
  const withoutDue = byId(buildEditTaskModal({ id: 1, subject: "X", status: "Open", due: null, owner: "Y" }, "url", "card"), "due_block").element as { initial_date?: string };
  assert.equal(withoutDue.initial_date, undefined);
});

test("buildEditTaskModal: owner uses Slack's native users_select and is never pre-selected", () => {
  const owner = byId(buildEditTaskModal({ id: 1, subject: "X", status: "Open", due: null, owner: "Maya Chen" }, "url", "card"), "owner_block");
  assert.equal(owner.element.type, "users_select");
  assert.equal("initial_user" in owner.element, false);
});

test("buildEditTaskModal: due, owner, and the update text are all optional; status is not", () => {
  const view = buildEditTaskModal({ id: 1, subject: "X", status: "Open", due: null, owner: "Y" }, "url", "card");
  assert.equal(byId(view, "status_block").optional, undefined);
  assert.equal(byId(view, "due_block").optional, true);
  assert.equal(byId(view, "owner_block").optional, true);
  assert.equal(byId(view, "update_block").optional, true);
});

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

function accessoryOf(block: unknown) {
  return (block as { accessory?: { type: string; action_id: string; value: string } }).accessory;
}

test("buildDigestBlocks: each of the first 10 actionable lines gets its own block with an Open accessory button", () => {
  const lines: DigestLine[] = Array.from({ length: 5 }, (_, i) => ({ subject: `Task ${i}`, taskId: i + 1 }));
  const blocks = buildDigestBlocks("intro", [{ lines }]);
  assert.equal(blocks.length, 6); // intro + 5 individual blocks, no grouped leftover
  for (let i = 0; i < 5; i++) {
    assert.equal(accessoryOf(blocks[i + 1])?.action_id, "task_edit_from_digest");
    assert.equal(accessoryOf(blocks[i + 1])?.value, String(i + 1));
  }
});

test("buildDigestBlocks: lines past the 10-actionable cap fall back to grouped, buttonless, chunked-by-10 blocks", () => {
  const lines: DigestLine[] = Array.from({ length: 12 }, (_, i) => ({ subject: `Task ${i}`, taskId: i + 1 }));
  const blocks = buildDigestBlocks("intro", [{ lines }]);
  // intro + 10 individual actionable blocks + 1 grouped block for the last 2
  assert.equal(blocks.length, 12);
  for (let i = 0; i < 10; i++) assert.ok(accessoryOf(blocks[i + 1]), `block ${i + 1} should have an accessory`);
  assert.equal(accessoryOf(blocks[11]), undefined);
  assert.equal(textOf(blocks[11]).split("\n").length, 2);
});

test("buildDigestBlocks: a closed task never gets an Open accessory, even within the cap", () => {
  const blocks = buildDigestBlocks("intro", [{ lines: [{ subject: "Done", taskId: 1, status: "Closed" }] }]);
  assert.equal(accessoryOf(blocks[1]), undefined);
});

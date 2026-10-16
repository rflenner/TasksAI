// Optional per-task checklist — requested 2026-09-14, "individually
// checkable and drive an 'in progress' change upon clicking". Pure and
// DB-free, same split as app/lib/task-flags.ts: easy to unit test,
// reused identically by the web app's PATCH handler and the Slack
// webhook's task_checklist_toggle handler so a checked box behaves the
// same regardless of where it was clicked.
import type { ChecklistItem } from "../../db/schema";

export function addChecklistItem(checklist: ChecklistItem[], id: string, text: string): ChecklistItem[] {
  const trimmed = text.trim();
  if (!trimmed) return checklist;
  return [...checklist, { id, text: trimmed, done: false }];
}

export function removeChecklistItem(checklist: ChecklistItem[], id: string): ChecklistItem[] {
  return checklist.filter(item => item.id !== id);
}

export function toggleChecklistItem(checklist: ChecklistItem[], id: string, done: boolean): ChecklistItem[] {
  return checklist.map(item => item.id === id ? { ...item, done } : item);
}

// Slack's checkboxes element reports back the complete current set of
// checked option ids on every interaction, not which one just flipped —
// so a Slack-originated toggle applies that whole set at once rather
// than toggling a single id, self-correcting any drift rather than
// diffing. Ids outside the visible (first 10, see MAX_CHECKLIST_ITEMS_
// IN_SLACK in app/lib/slack.ts) window are left exactly as they were —
// Slack never reported on them either way, so nothing to apply.
export function applyChecklistSelection(checklist: ChecklistItem[], visibleIds: string[], checkedIds: Set<string>): ChecklistItem[] {
  return checklist.map(item => visibleIds.includes(item.id) ? { ...item, done: checkedIds.has(item.id) } : item);
}

// Whether this checklist edit is itself a "someone's making progress"
// signal — same role updatesGrew already plays for a posted status
// note: feeds autoAdvanceStatus's Open -> In progress bump. Only a
// newly-checked item counts, not an unchecked one — unchecking an item
// isn't progress, and undoing a task's own auto-advance because someone
// corrected a mis-click would be a stranger behavior than just leaving
// the status as it is.
export function checklistJustAdvanced(before: ChecklistItem[], after: ChecklistItem[]): boolean {
  const doneBefore = new Set(before.filter(item => item.done).map(item => item.id));
  return after.some(item => item.done && !doneBefore.has(item.id));
}

// Finds the checklist item a spoken/typed phrase most likely refers to —
// for app/lib/voice-query.ts's set_checklist_item_done action, where
// there's no id to click, only whatever text the person said ("mark the
// Slack message one done"). Exact (case-insensitive) match wins outright;
// otherwise falls back to whichever item's text contains the phrase or
// vice versa, preferring the longest overlap as the least ambiguous
// guess. Returns null rather than guessing wildly when nothing overlaps
// at all — the caller turns that into "I couldn't find that," not a
// wrong item silently getting checked.
export function matchChecklistItem(checklist: ChecklistItem[], spoken: string): ChecklistItem | null {
  const needle = spoken.trim().toLowerCase();
  if (!needle) return null;
  const exact = checklist.find(item => item.text.toLowerCase() === needle);
  if (exact) return exact;
  const overlapping = checklist.filter(item => {
    const text = item.text.toLowerCase();
    return text.includes(needle) || needle.includes(text);
  });
  if (!overlapping.length) return null;
  return overlapping.reduce((best, item) => item.text.length > best.text.length ? item : best);
}

// Readable Task History lines for a checklist edit — same wording
// Slack's own task_checklist_toggle handler already writes inline
// (app/api/webhooks/slack/route.ts), pulled out here so the voice "act"
// path can log identically without duplicating that phrasing. Only ever
// called with a single checklist action applied per turn in practice,
// but handles a full before/after diff generally: added items, then
// newly-checked/-unchecked ones.
export function describeChecklistChanges(before: ChecklistItem[], after: ChecklistItem[]): string[] {
  const lines: string[] = [];
  const beforeIds = new Set(before.map(item => item.id));
  for (const item of after) if (!beforeIds.has(item.id)) lines.push(`added "${item.text.slice(0, 140)}" to the checklist`);
  const beforeDoneById = new Map(before.map(item => [item.id, item.done]));
  for (const item of after) {
    const wasDone = beforeDoneById.get(item.id);
    if (wasDone === undefined || wasDone === item.done) continue;
    lines.push(item.done ? `checked off "${item.text.slice(0, 140)}"` : `unchecked "${item.text.slice(0, 140)}"`);
  }
  return lines;
}

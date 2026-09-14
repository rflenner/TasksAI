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

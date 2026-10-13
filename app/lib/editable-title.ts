// What clicking away from (or pressing Enter in) the task heading should save.
// The heading is edited in place (app/components/EditableTitle.tsx), so this
// decides whether anything needs saving at all: returns the new subject, or
// null when it didn't change or was emptied — an emptied heading goes back to
// what it was rather than saving a task with no subject (the old Subject box
// behaved the same way). Line breaks become spaces; a subject is one line.
export function commitTitle(original: string, draft: string): string | null {
  const next = draft.replace(/\s+/g, " ").trim();
  if (!next || next === original.trim()) return null;
  return next;
}

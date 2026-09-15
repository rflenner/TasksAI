// Shared "what due date does a task get when nothing real was ever
// given" rule — every creation path used to just leave `due` as an
// empty string in that case (manual create, paste-minutes/dictation via
// POST /api/tasks, voice "create a task", the inbound-email webhook,
// Sales AI sync), and an empty string sorts before any real YYYY-MM-DD,
// so a task with genuinely no due date read as overdue immediately
// (`due < today` is true for ""). Requested 2026-09-15: "I think we
// should not have tasks without a deadline anyway" — rather than treat
// "no due date" as its own valid state every reader has to special-case
// around, every task gets a real one, 7 calendar days out from its own
// created date, whenever nothing more specific was ever mentioned or
// set. Calendar days, not business days: a flat week is simpler to
// reason about for a plain "we genuinely don't know" fallback than
// skipping weekends would be.
export function defaultDueDate(createdISO: string, days = 7): string {
  const date = new Date(`${createdISO.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The one place every insert/update site should go through: a due value
// only counts if it's a genuine YYYY-MM-DD (matches every existing
// per-caller check this replaces — an empty string, null/undefined, or
// any stray non-date text all fall back to defaultDueDate the same way).
export function resolveDueDate(due: string | null | undefined, createdISO: string, days = 7): string {
  return due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : defaultDueDate(createdISO, days);
}

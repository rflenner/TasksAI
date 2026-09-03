// Pure grouping logic behind ContactPicklist (app/components/ContactPicklist.tsx) —
// kept DOM-free so the pin-to-top/search rule is unit-tested directly, the
// same split this session has used everywhere else (classifyForDigest,
// resolveRegisteredName, etc.).
//
// `pinned` is always the full, unfiltered selection, in pick order — the
// approved spec (2026-09-03 UI proposal) is explicit that already-picked
// people stay visible "even while you keep typing to search for someone
// new", so the search query only ever narrows `rest`, never `pinned`.
// This also means a selected value that's since dropped out of `options`
// entirely (a legacy value, say) still shows up pinned and removable,
// rather than silently vanishing from the list it's still the value of.
export type PicklistGroups = { pinned: string[]; rest: string[] };

export function groupOptions(options: string[], selected: string[], query: string): PicklistGroups {
  const q = query.trim().toLowerCase();
  const candidates = q ? options.filter(option => option.toLowerCase().includes(q)) : options;
  const rest = candidates.filter(option => !selected.includes(option));
  return { pinned: selected, rest };
}

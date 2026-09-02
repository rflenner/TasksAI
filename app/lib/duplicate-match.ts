import type { RetagType } from "./data-hygiene";

// Pure and dependency-free on purpose — this needs to run client-side (the
// Data Hygiene page recomputes suggestions live as the list changes, no
// round trip needed) as well as server-side later for Phase 2/3 matching
// against new entries. data-hygiene.ts itself can't be imported from a
// client component: it pulls in the postgres driver via getDb().

// Classic dynamic-programming edit distance. O(n*m), fine at this app's
// scale — a handful of dimension values per type, not thousands.
export function levenshtein(a: string, b: string): number {
  const rows = a.length + 1, cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

export type DuplicateSuggestion = { type: RetagType; a: string; b: string; reason: string };

const normalize = (value: string) => value.trim().toLowerCase();

// Every rule here is advisory, not a match to act on automatically — these
// pairs sit in front of a human on the Data Hygiene page, who picks which
// one survives (or dismisses the pair). That's a deliberately different bar
// than Phase 2/3's live-typing suggestions: this is judging two names that
// already exist as distinct, independently-created values, which is exactly
// the kind of call that shouldn't happen silently.
export function findDuplicateSuggestions(type: RetagType, values: string[]): DuplicateSuggestion[] {
  const suggestions: DuplicateSuggestion[] = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const a = values[i], b = values[j], na = normalize(a), nb = normalize(b);
      if (!na || !nb) continue;
      if (na === nb) { suggestions.push({ type, a, b, reason: "Same name, different capitalization" }); continue; }
      // person only: one value is exactly the other's first word — "Drew"
      // vs "Drew Klein". Deliberately narrow: two different full names that
      // happen to share a first word ("Pavneet Saluja" / "Pavneet Kumar")
      // never match this, since neither whole string equals just the
      // shared first word.
      if (type === "person") {
        const firstA = na.split(/\s+/)[0], firstB = nb.split(/\s+/)[0];
        if (na === firstB || nb === firstA) { suggestions.push({ type, a, b, reason: "Looks like a short form of the same name" }); continue; }
      }
      const distance = levenshtein(na, nb), maxLen = Math.max(na.length, nb.length);
      if (maxLen >= 4 && distance <= (maxLen <= 6 ? 1 : 2)) suggestions.push({ type, a, b, reason: "Looks like a typo of each other" });
    }
  }
  return suggestions;
}

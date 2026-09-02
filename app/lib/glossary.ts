// Builds the Keyterm Prompting boost list for Deepgram's live transcription
// WebSocket — each entry becomes its own `keyterm=` query parameter on that
// URL (see app/api/dictate/token/route.ts and app/dictate/DictateClient.tsx),
// unlike a POST body, so the whole list has to fit in one URL, and the
// source table (dimensionValues) only ever grows.
//
// Diagnosed live on 2026-09-02: 109 accumulated dimension values (capped at
// 100 by the caller) produced a URL long enough that the WebSocket
// connection was silently dropped before any handshake response came
// back — curl against the bare endpoint always succeeded (proving the key,
// project, and origin were all fine), but the real URL with the full
// keyterm list never got a response at all.
//
// A raw entry count isn't a safe limit on its own — this table can and
// does contain accidental sentence-length values (a meeting once got named
// after 70+ characters of dictated text) — so this caps both the length of
// any single term (Keyterm Prompting is meant for short proper nouns/
// vocabulary, not full sentences) and the combined length of the whole
// list, not just how many terms are considered.
export const KEYTERM_MAX_CHARS = 40;
export const KEYTERM_BUDGET_CHARS = 1500;

export function buildGlossary(values: string[]): string[] {
  const glossary: string[] = [];
  let budget = KEYTERM_BUDGET_CHARS;
  for (const raw of values) {
    const term = raw.trim();
    if (!term || term.length > KEYTERM_MAX_CHARS) continue;
    if (term.length > budget) break;
    glossary.push(term);
    budget -= term.length;
  }
  return glossary;
}

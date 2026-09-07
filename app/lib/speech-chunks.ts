// Splits a spoken answer into individual sentences so VoiceAsk's
// speak() can pipeline their synthesis — confirmed live 2026-09-08,
// requested after "worthwhile looking into streaming": true byte-level
// audio streaming needs a MediaSource rearchitecture with real cross-
// browser format risk this app can't validate without a live Deepgram
// key. This gets most of the same win far more simply: a longer answer
// (a walk read-out's name/description/due-date/prompt, or a multi-step
// act's several confirmations) is already built from separate
// sentences server-side — synthesizing and playing each one as soon as
// it's ready, instead of waiting for the whole thing to be one audio
// file, cuts time-to-first-sound down to just the first sentence's
// synthesis time. A single-sentence answer still comes back as one
// chunk, so nothing changes for those.
export function splitIntoSpeechChunks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== "." && trimmed[i] !== "!" && trimmed[i] !== "?") continue;
    const chunk = trimmed.slice(start, i + 1).trim();
    if (chunk) chunks.push(chunk);
    let next = i + 1;
    while (next < trimmed.length && /\s/.test(trimmed[next])) next++;
    start = next; i = next - 1;
  }
  const rest = trimmed.slice(start).trim();
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [trimmed];
}

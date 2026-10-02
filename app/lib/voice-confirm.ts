// How a spoken reply to a yes/no gate (notify, delete) is read — shared by
// both voice assistants. Requested 2026-10-02 after a live session where
// "No, can you send a notification to Xenofon?" (a "no" to the draft that
// was just read out, plus a NEW instruction) was treated as a plain "no"
// and the instruction thrown away, and where a reply that was neither yes
// nor no ("Shankar has sent the presentation, but we need to...") was
// answered with "I didn't catch a yes or no" and likewise dropped.
//
// Safety is unchanged: nothing outbound or destructive ever happens
// without an unambiguous leading "yes". The change is only in what
// happens to everything else — the pending action is always cancelled, and
// anything substantive the person said is handed back as a fresh request
// instead of being swallowed.
const YES = /^\s*(yes|yeah|yep|yup|confirm(ed)?|do it|go ahead|correct|sure|please do)\b[\s,.!]*/i;
const NO = /^\s*(no|nope|never\s?mind|cancel|stop|don'?t)\b[\s,.!]*/i;

export type ConfirmReply =
  | { decision: "yes"; newRequest: null }
  | { decision: "no"; newRequest: string | null }
  | { decision: "other"; newRequest: string };

// A "no" followed by at least this many words is treated as "no, and
// here's something else" rather than a bare refusal.
const MIN_WORDS_FOR_NEW_REQUEST = 4;

// A "yes" followed by this many more words is "yes, but …" / "yes and
// also …" — not a clean go-ahead for the exact thing that was read out,
// so it cancels it and is handled as a new request instead.
const MAX_WORDS_AFTER_YES = 3;
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function interpretConfirmReply(text: string): ConfirmReply {
  const trimmed = text.trim();
  const yes = YES.exec(trimmed);
  if (yes) {
    if (wordCount(trimmed.slice(yes[0].length)) <= MAX_WORDS_AFTER_YES) return { decision: "yes", newRequest: null };
    return { decision: "other", newRequest: trimmed };
  }
  const no = NO.exec(trimmed);
  if (no) {
    const rest = trimmed.slice(no[0].length).trim();
    return { decision: "no", newRequest: wordCount(rest) >= MIN_WORDS_FOR_NEW_REQUEST ? rest : null };
  }
  return { decision: "other", newRequest: trimmed };
}

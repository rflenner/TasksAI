// "Only count what the person actually said": shared by the voice assistants
// (close plan: close-plan-voice.ts, Task AI: voice-task-draft.ts). The AI that
// reads a spoken request fills in a form; a live test showed it also fills in
// what nobody said (a phase, an owner, a parent task, a due date). Anything that
// goes into a task has to be traceable to the person's own words.

export const squash = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

const words = (s: string) => squash(s).split(" ").filter(w => w.length >= 3);

// Text written into a task (an update, a new title or details) must come from
// what was said: a live test had "mark it done" also post an update
// "Marked complete per your request." that nobody said.
export function grounded(text: string, utterance: string): boolean {
  const said = new Set(words(utterance)), own = words(text);
  if (!own.length) return false;
  return own.filter(w => said.has(w)).length / own.length >= 0.6;
}

// A name (phase, person, project…) counts when the person said all of it, or
// one of its words of three letters or more ("Sam" for "Sam Seller").
export function namedIn(utterance: string, name: string): boolean {
  const u = ` ${squash(utterance)} `, full = squash(name);
  if (!full) return false;
  return u.includes(` ${full} `) || full.split(" ").some(w => w.length >= 3 && u.includes(` ${w} `));
}

// A date only counts when the person said something date-like.
export const mentionsDate = (utterance: string) =>
  /\b(today|tomorrow|tonight|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(r|rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?|next|week|month|weeks|months|days?|end of|eod|\d)\b/i.test(utterance);

// "Skip", "that's all", "no": the person declines to answer more questions.
export const declinesMore = (utterance: string) =>
  /^\s*(skip( it| that| this)?|that'?s all|that is all|that'?s fine|it'?s fine|no thanks?|no|nope|nothing( else)?|none|leave it|leave it out|never ?mind|just create it|go ahead|create it|that'?s it)[\s.!,]*$/i.test(utterance);

// The next three weeks with their weekdays, so "Friday" or "next Tuesday" lands
// on the right date (a live test turned "due Friday" into a Thursday).
export function calendar(today: string, days = 21): string {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    out.push(`${d.toISOString().slice(0, 10)} ${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`);
  }
  return out.join(", ");
}

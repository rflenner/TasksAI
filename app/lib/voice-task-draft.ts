// Creating a task by voice in Task AI takes a short conversation: the assistant
// reads what was said, checks which project it belongs to, and asks once for the
// owner, due date and description that are missing ("skip" creates it with
// defaults). Pure and DB-free so the rules are unit-tested
// (tests/voice-task-draft.test.ts); app/api/voice-query does the AI calls and
// the insert. The close plan assistant works the same way (close-plan-voice.ts).
import { declinesMore, grounded, mentionsDate, namedIn } from "./voice-grounding";

export type TaskDraft = {
  subject: string; description: string | null;
  owner: string | null; collaborators: string[]; recipients: string[];
  due: string | null; project: string | null; topic: string | null; recurringMeeting: string | null;
  askedDetails: boolean;
};
export type KnownLists = { people: string[]; projects: string[]; topics: string[]; meetings: string[] };
// What the AI read out of the person's ANSWER to the assistant's question.
export type AnswerFill = { project: string | null; owner: string | null; due: string | null; description: string | null; topic: string | null; recurringMeeting: string | null };
export type ExtractedForDraft = { subject: string; description: string; owner: string | null; collaborators: string[]; recipients: string[]; due: string | null; topic: string | null; project: string | null; recurringMeeting: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const lc = (s: string) => s.trim().toLowerCase();
const known = (list: string[], v: string | null | undefined) => v ? list.find(x => lc(x) === lc(v)) ?? null : null;
const selfSaid = (utterance: string) => /\b(me|myself)\b/i.test(utterance);

// A draft sent back by the page is untrusted input.
export function sanitizeTaskDraft(raw: unknown): TaskDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const s = (v: unknown, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
  const list = (v: unknown) => Array.isArray(v) ? v.filter(x => typeof x === "string").map(x => (x as string).trim().slice(0, 100)).filter(Boolean).slice(0, 10) : [];
  const subject = s(d.subject, 140); if (!subject) return null;
  return {
    subject, description: s(d.description, 4000) || null, owner: s(d.owner, 100) || null, collaborators: list(d.collaborators), recipients: list(d.recipients),
    due: typeof d.due === "string" && DATE.test(d.due) ? d.due : null, project: s(d.project, 100) || null, topic: s(d.topic, 100) || null, recurringMeeting: s(d.recurringMeeting, 100) || null,
    askedDetails: d.askedDetails === true,
  };
}

// The first request: the task extraction (the same one Dictate uses) fills in a
// form; keep only what the person's own words support. A description only
// counts when they said one ("…the description is …"); an owner, project or
// date only when named. Everything else is asked for.
export function draftFromExtraction(item: ExtractedForDraft, transcript: string, actorName: string, lists: KnownLists): TaskDraft {
  const owner = item.owner && namedIn(transcript, item.owner) ? item.owner : item.owner && selfSaid(transcript) && lc(item.owner) === lc(actorName) ? item.owner : null;
  const said = (v: string | null, list: string[]) => { const k = known(list, v); return k && namedIn(transcript, k) ? k : null; };
  const explicitDescription = /\b(description|details?|notes?|saying|context)\b/i.test(transcript) && item.description && lc(item.description) !== lc(item.subject) && grounded(item.description, transcript);
  return {
    subject: item.subject.trim().slice(0, 140),
    description: explicitDescription ? item.description.trim() : null,
    owner, collaborators: item.collaborators.filter(c => namedIn(transcript, c)), recipients: item.recipients.filter(r => namedIn(transcript, r)),
    due: item.due && DATE.test(item.due) && mentionsDate(transcript) ? item.due : null,
    project: said(item.project, lists.projects), topic: said(item.topic, lists.topics), recurringMeeting: said(item.recurringMeeting, lists.meetings),
    askedDetails: false,
  };
}

// The person's answer: merge what the AI read out of it, again keeping only what
// their words support. `changed` is false when the answer added nothing (the
// caller then treats it as a new request instead).
export function mergeAnswer(d: TaskDraft, answer: string, fill: AnswerFill, actorName: string, lists: KnownLists, firstRequest = false): { draft: TaskDraft; changed: boolean } {
  const next = { ...d };
  let changed = false;
  const project = known(lists.projects, fill.project); if (project && namedIn(answer, project)) { next.project = project; changed = true; }
  const topic = known(lists.topics, fill.topic); if (topic && namedIn(answer, topic)) { next.topic = topic; changed = true; }
  const meeting = known(lists.meetings, fill.recurringMeeting); if (meeting && namedIn(answer, meeting)) { next.recurringMeeting = meeting; changed = true; }
  const person = fill.owner ? (known(lists.people, fill.owner) ?? lists.people.find(p => lc(p).split(/\s+/)[0] === lc(fill.owner!))) : null;
  if (person && (namedIn(answer, person) || (selfSaid(answer) && lc(person) === lc(actorName)))) { next.owner = person; changed = true; }
  if (fill.due && DATE.test(fill.due) && mentionsDate(answer)) { next.due = fill.due; changed = true; }
  // In the first sentence the AI echoes the task itself as its "description", so there a description only counts
  // when the person says they're giving one; in an answer to "anything for the description?" it always counts.
  const gives = !firstRequest || /\b(description|details?|notes?|saying|context)\b/i.test(answer);
  if (gives && fill.description && fill.description.trim() && grounded(fill.description, answer)) { next.description = fill.description.trim().slice(0, 4000); changed = true; }
  return { draft: next, changed };
}

export const missingFields = (d: TaskDraft) =>
  [!d.project && "project", !d.owner && "owner", !d.due && "due", !d.description && "description"].filter(Boolean) as Array<"project" | "owner" | "due" | "description">;

export function askQuestion(d: TaskDraft, projects: string[]): string {
  const part = { project: "which project it belongs to", owner: "who should own it", due: "when it's due", description: "anything for the description" };
  const parts = missingFields(d).map(m => part[m]);
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const hint = !d.project && projects.length ? ` Projects: ${projects.slice(0, 5).join(", ")}${projects.length > 5 ? " and more" : ""}.` : "";
  return `For "${d.subject}": ${joined.replace(/^./, c => c.toUpperCase())}? Or say skip.${hint}`;
}

export type DraftStep = { kind: "ask"; draft: TaskDraft; question: string } | { kind: "create"; draft: TaskDraft; defaults: Array<"owner" | "due"> };

// Ask once for whatever is missing; after that (or on "skip") create the task
// with defaults: the speaker as owner, a due date a week out, no project.
export function nextStep(d: TaskDraft, declined: boolean, projects: string[]): DraftStep {
  if (missingFields(d).length && !d.askedDetails && !declined) return { kind: "ask", draft: { ...d, askedDetails: true }, question: askQuestion(d, projects) };
  return { kind: "create", draft: d, defaults: [!d.owner && "owner", !d.due && "due"].filter(Boolean) as Array<"owner" | "due"> };
}

export { declinesMore };

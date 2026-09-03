// A single stream-of-consciousness dictation naturally touches several
// sub-points ("discuss the roadmap, and also check in on the Jira setup,
// and one more thing...") without the speaker meaning to create a
// separate task per point — confirmed live 2026-09-03: one dictation
// session split into 4 disconnected tasks nobody asked for. Dictation
// defaults to exactly one task per session; a speaker who explicitly
// wants several says so, with one of these phrases.
const MULTI_TASK_SIGNALS = [
  /create multiple tasks/i,
  /multiple tasks/i,
  /separate tasks/i,
  /next task/i,
  /another task/i,
  /second task/i,
  /third task/i,
  /fourth task/i,
  /task (two|three|four|five|six|\d+)\b/i,
];

export function detectsMultiTaskTrigger(text: string): boolean {
  return MULTI_TASK_SIGNALS.some(signal => signal.test(text));
}

type ExtractedTask = {
  subject: string;
  description: string;
  owner?: string | null;
  collaborators?: string[];
  recipients?: string[];
  due?: string | null;
  topic?: string | null;
  project?: string | null;
  recurringMeeting?: string | null;
};

// Deterministic backstop for when the model splits into several tasks
// anyway despite the prompt instruction not to, on an untriggered
// dictation — LLMs don't always follow instructions perfectly, and this
// needs to actually hold, not just usually hold. Folds every extracted
// task into one: descriptions are joined (nothing the model correctly
// picked up gets thrown away), and the first non-empty value wins for
// single-value fields (owner/due/topic/project/recurringMeeting) since
// they should already agree across items pulled from one dictation.
// Collaborators/recipients are unioned, de-duplicated.
export function collapseToSingleTask(items: ExtractedTask[]): ExtractedTask {
  const first = items[0];
  const firstNonEmpty = (key: "owner" | "due" | "topic" | "project" | "recurringMeeting") =>
    items.map(item => item[key]).find(value => value) ?? first[key] ?? null;
  const union = (key: "collaborators" | "recipients") =>
    [...new Set(items.flatMap(item => item[key] || []))];
  return {
    subject: first.subject,
    description: [...new Set(items.map(item => item.description || item.subject).filter(Boolean))].join(" "),
    owner: firstNonEmpty("owner"),
    collaborators: union("collaborators"),
    recipients: union("recipients"),
    due: firstNonEmpty("due"),
    topic: firstNonEmpty("topic"),
    project: firstNonEmpty("project"),
    recurringMeeting: firstNonEmpty("recurringMeeting"),
  };
}

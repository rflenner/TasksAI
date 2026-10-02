// What each voice assistant can do, in the words a person would use: one list
// per place the assistant runs, used for the "What can I say?" panel, the
// spoken answer to "what can you do?" and (later) the guided tour, so help
// never promises more than exists. Lines with "…" are patterns to say, not to
// tap. The close plan's list lives next to its assistant (close-plan-voice.ts).

export type Capability = { group: string; items: string[] };

export const isHelpRequest = (u: string) => /\b(what can (you|i) (do|say|ask)|what are you able to do|how (can|do) (you|i) (help|use you)|what do you (do|know))\b|^\s*help\b/i.test(u);

// Task AI's own voice assistants (Live Voice Assistant and Ask Task AI), which
// share /api/voice-query.
export function taskAiCapabilities(person: string): Capability[] {
  return [
    { group: "Ask", items: ["Give me my briefing", "What's due today?", "What's overdue?", `When was ${person} last online?`] },
    { group: "Find", items: ["Show my tasks", "Show new tasks", "What's due this week?", "Tasks I requested", "Has anything been updated?", `Show tasks with ${person}`] },
    { group: "Go through a list", items: ["Go through my overdue tasks", "Next", "Open the first one", "Open task …"] },
    { group: "Change a task", items: ["Post an update: …", "Mark it done", "Move it to Friday", `Assign it to ${person}`, "Set the priority to high", "Check off …", "Add … to the checklist"] },
    { group: "Create", items: ["Create a task: …, due …", "Dictate a task", "Paste meeting minutes"] },
    { group: "Tell someone", items: ["Notify the owner", `Let ${person} know …`] },
    { group: "Ideas", items: ["I wish you could …"] },
  ];
}

export const TASK_AI_HELP = "I can give you your briefing, find tasks, like what's overdue, new or due this week, walk through a list with you, update, move, assign and check off tasks, create tasks, and notify people about a task. The full list is in the panel under \"What can I say?\". And if you wish I could do something else, just tell me.";

// The first time someone uses a voice assistant, the greeting also says what it can do, once.
export const FIRST_TIME_HINT = "You can ask me what's overdue, go through your tasks with me, or tell me to update one. Say \"what can you do\" any time.";

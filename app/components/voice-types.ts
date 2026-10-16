// Shapes the Live Voice Assistant (VoiceAskRealtime.tsx) and the main task
// screen (TaskApp.js) share for what /api/voice-query hands back. They used to
// live in VoiceAsk.tsx, the retired Deepgram "Ask Task AI" panel; they moved
// here when that panel was removed so the live assistant owns them.

export type VoiceFilters = {
  owner: string | null; mineOnly: boolean; myRole: "collaborator" | "recipient" | null;
  project: string | null; topic: string | null; recurringMeeting: string | null;
  account: string | null; opportunity: string | null; source: string | null;
  priority: "Low" | "Medium" | "High" | null; dueWithin: "week" | "overdue" | null;
  createdWithin: "today" | null; closedWithin: "today" | null; status: string | null;
  textContains: string | null; isNew: boolean; hasUnseenUpdate: boolean;
};
// Screens a voice request can open without leaving the page.
export type VoiceNavigateTarget = "new_task" | "paste_minutes";
// What an "act" response hands back — every field any voice-driven
// change could have touched (subject, description, project, topic,
// coworkers/recipients, due, status+closedAt together, priority,
// owner, updates, or checklist), so the caller can merge this straight
// into its task state without a full refetch.
export type VoiceTaskUpdate = {
  id: number; subject: string; description: string; owner: string; collaborators: string[]; recipients: string[];
  due: string; status: string; priority: string; project: string; topic: string; closedAt: string | null; updates: Array<{ text: string; at: string; by?: string }>;
  checklist: Array<{ id: string; text: string; done: boolean }>;
};
// What mode "notify" hands back once it's resolved who to tell and
// drafted what to say — nothing is actually sent until the NEXT
// utterance confirms it (see pendingNotifyRef in VoiceAskRealtime.tsx),
// same confirm-then-execute shape mode "confirm_delete" already uses.
export type PendingNotify = { taskId: number; toEmail: string; toName: string; channel: "email" | "slack"; message: string };
// A brand-new task voice created directly from a spoken description
// (mode "create_task") — the full row, same shape GET /api/tasks
// returns, so the caller can just prepend it to its task list.
export type VoiceCreatedTask = Record<string, unknown> & { id: number; subject: string };
export type VoiceDimensions = { project: string[]; meeting: string[]; topic: string[]; person: string[] };

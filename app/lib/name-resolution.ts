// Matches a name fragment the AI extraction returned — often just a first
// name, since that's frequently all a dictated sentence actually contains
// ("create a task for Xenofon") — against Task AI's own registered users.
// Without this, "Xenofon" and the registered "Xenofon Papadopoulos" are
// just two different strings to register()/onConflictDoNothing (see
// app/api/tasks/route.ts): confirmed live on 2026-09-03, dictating "for
// Xenofon, Shankar and Drew" minted three new, disconnected recipient
// strings instead of matching the three actual registered users of those
// names.
//
// Deliberately conservative: only resolves a match when there's exactly
// one candidate. A first name shared by two registered users, or no
// candidate at all (a real external name outside the company), is left
// exactly as spoken rather than guessing — a wrong silent substitution
// (crediting the wrong "Shankar") would be worse than an occasional
// unmatched new name, which is exactly what free-text owner/collaborator/
// recipient fields are designed to tolerate anyway.
export function resolveRegisteredName(spoken: string, registeredNames: string[]): string {
  const cleaned = spoken.trim();
  if (!cleaned) return cleaned;
  const lower = cleaned.toLowerCase();
  const exact = registeredNames.find(name => name.trim().toLowerCase() === lower);
  if (exact) return exact.trim();
  const firstNameMatches = registeredNames.filter(name => name.trim().toLowerCase().split(/\s+/)[0] === lower);
  return firstNameMatches.length === 1 ? firstNameMatches[0].trim() : cleaned;
}

// Dictating "assign this to me" gets extracted with a literal owner of
// "me" — a real word, so the absent-owner default (see app/api/extract/
// route.ts) never kicks in, and "me" doesn't match anyone in
// resolveRegisteredName either. Confirmed live 2026-09-03: a task
// dictated for the speaker landed with owner "me" instead of their own
// name. Checked before registered-name matching, and only when the
// caller actually knows who's speaking (selfName — dictation only, never
// pasted-minutes, where there's no one "speaking" to resolve "me" to).
const SELF_REFERENCES = new Set(["me", "myself", "i"]);
function resolveSelfReference(spoken: string, selfName?: string): string {
  if (!selfName) return spoken;
  return SELF_REFERENCES.has(spoken.trim().toLowerCase()) ? selfName : spoken;
}

type NameableTask = { owner?: string | null; collaborators?: string[]; recipients?: string[] };

// Applies resolveRegisteredName across everyone named on one extracted
// task — owner, collaborators, and recipients alike, the same three
// fields register() writes into the People list — so a match gets the
// same treatment wherever a name can appear, not just recipients.
export function resolveTaskNames<T extends NameableTask>(task: T, registeredNames: string[], selfName?: string): T {
  const resolve = (name: string) => resolveRegisteredName(resolveSelfReference(name, selfName), registeredNames);
  return {
    ...task,
    owner: task.owner ? resolve(task.owner) : task.owner,
    collaborators: (task.collaborators || []).map(resolve),
    recipients: (task.recipients || []).map(resolve),
  };
}

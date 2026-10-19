// The bell on a Close Plan task: send a note about the task to the people on it, by Slack or email, in your own words. The same flow
// as the bell in Task AI (app/api/tasks/notify): pick people, pick a channel, edit a draft, send. A person-picked send, so it is not
// held back by the weekly cap for customers, but people who asked not to be emailed are never emailed, and customers are only emailed
// once they have been invited (the note carries a fresh personal link).
import { renderTaskNote } from "./close-plan-emails";
import { appBase, logEmail, slackDirect, unsubscribeUrl } from "./close-plan-invitations";
import { createPlanLink } from "./close-plan-links";
import { isOptedOut, normalizeEmail } from "./close-plan-notify-rules";
import { sendWithResend } from "./email";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : [];

export type NoteChannel = "email" | "slack";
export type NoteCandidate = { personId: string; name: string; side: "seller" | "buyer"; role: "Owner" | "Coworker" | "Requested by"; email: string; channels: NoteChannel[]; blocked?: string };
export const MAX_NOTE_RECIPIENTS = 10, MAX_NOTE_LENGTH = 1000;

// Owner, coworkers and requesters of the task, once each, in that order.
export function peopleOnTask(data: Obj, taskId: string): Array<{ person: Obj; role: NoteCandidate["role"] }> {
  const task = arr(data.tasks).find(t => String(t.id) === taskId); if (!task) return [];
  const people = arr(data.people), seen = new Set<string>(), out: Array<{ person: Obj; role: NoteCandidate["role"] }> = [];
  const add = (id: unknown, role: NoteCandidate["role"]) => { if (typeof id !== "string" || seen.has(id)) return; const person = people.find(p => p.id === id); if (person) { seen.add(id); out.push({ person, role }); } };
  add(task.owner, "Owner"); strs(task.coworkers).forEach(id => add(id, "Coworker")); strs(task.recipients).forEach(id => add(id, "Requested by"));
  return out;
}

// What each person can be reached on, and why not when they can't. `hasSlack` answers "is there a Slack account at this address" (injected so it can be tested).
export async function noteCandidates(data: Obj, taskId: string, hasSlack: (email: string) => Promise<boolean>): Promise<NoteCandidate[]> {
  return Promise.all(peopleOnTask(data, taskId).map(async ({ person, role }) => {
    const side = person.side === "buyer" ? "buyer" : "seller", email = typeof person.email === "string" ? normalizeEmail(person.email) : "";
    const base = { personId: String(person.id), name: String(person.name || ""), side, role, email } as const;
    const channels: NoteChannel[] = [];
    let blocked: string | undefined;
    if (!email) blocked = "no email address";
    else {
      const status = (person.invite as Obj | undefined)?.status;
      if (person.noEmail === true || await isOptedOut(email)) blocked = "asked not to get emails";
      else if (side === "buyer" && status !== "invited" && status !== "active") blocked = "not invited to the plan yet";
      else channels.push("email");
      if (side === "seller" && email && await hasSlack(email).catch(() => false)) channels.push("slack");
    }
    // Slack to an iSEEit colleague still works when they opted out of emails.
    return { ...base, channels, ...(blocked && !channels.length ? { blocked } : {}) };
  }));
}

export type NoteResult = { personId: string; name: string; sent: boolean; reason?: string };

export async function sendTaskNotes(input: { plan: { id: string; title: string; data: Obj }; taskId: string; personIds: string[]; channel: NoteChannel; message: string; fromName: string; baseUrl?: string }): Promise<NoteResult[]> {
  const { plan } = input, task = arr(plan.data.tasks).find(t => String(t.id) === input.taskId);
  if (!task) return [];
  const today = new Date().toISOString().slice(0, 10);
  const note = { title: String(task.title || ""), due: typeof task.due === "string" ? task.due : null, overdue: typeof task.due === "string" && task.due < today && task.status !== "Closed", description: typeof task.desc === "string" ? task.desc.slice(0, 400) : undefined, status: typeof task.status === "string" ? task.status : undefined };
  const wanted = new Set(input.personIds), results: NoteResult[] = [];
  for (const { person } of peopleOnTask(plan.data, input.taskId)) {
    const personId = String(person.id); if (!wanted.has(personId)) continue;
    const name = String(person.name || ""), email = typeof person.email === "string" ? normalizeEmail(person.email) : "", first = name.split(/\s+/)[0] || "there";
    const done = (sent: boolean, reason?: string) => results.push({ personId, name, sent, ...(reason ? { reason } : {}) });
    try {
      if (!email) { done(false, "no email address"); continue; }
      if (input.channel === "slack") {
        if (person.side === "buyer") { done(false, "customers are reached by email"); continue; }
        const ok = await slackDirect(email, `🔔 ${input.fromName} on *${note.title}* (${plan.title}): ${input.message}\n${appBase(input.baseUrl)}/close-plans`);
        done(ok, ok ? undefined : "no Slack account at this address"); continue;
      }
      if (person.noEmail === true || await isOptedOut(email)) { done(false, "asked not to get emails"); continue; }
      let url = `${appBase(input.baseUrl)}/close-plans`;
      if (person.side === "buyer") {
        const status = (person.invite as Obj | undefined)?.status;
        if (status !== "invited" && status !== "active") { done(false, "not invited to the plan yet"); continue; }
        url = `${appBase(input.baseUrl)}/p/${(await createPlanLink(plan.id, personId, null)).token}`;
      }
      const mail = renderTaskNote({ firstName: first, fromName: input.fromName, planTitle: plan.title, message: input.message, task: note, url, unsubscribeUrl: unsubscribeUrl(email, input.baseUrl) });
      const r = await sendWithResend({ to: email, subject: mail.subject, html: mail.html, text: mail.text }).catch(error => ({ sent: false, reason: error instanceof Error ? error.message : "could not send" }));
      if (r.sent) await logEmail("manual_notify", plan.id, personId, email, input.taskId);
      done(Boolean(r.sent), r.sent ? undefined : ("reason" in r && r.reason ? r.reason : "could not send"));
    } catch (error) { done(false, error instanceof Error ? error.message : "could not send"); }
  }
  return results;
}

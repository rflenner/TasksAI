// Who gets a Close Plan invitation or notice by email, and the sending. The wording is in close-plan-emails.ts, the rules and
// the opt-out list in close-plan-notify-rules.ts (Admin → Notifications). Everything sent is logged in close_plan_email_log,
// which is what the reminder job and the weekly cap per customer read.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanEmailLog, closePlanLinks } from "../../db/schema";
import { accessOf, customerPerson, isShared } from "./close-plan-share";
import { accessSummary, renderAddedToPlan, renderInvitation, type PlanEmailTask, type Rendered } from "./close-plan-emails";
import { createPlanLink } from "./close-plan-links";
import { customerBase, internalBase } from "./close-plan-urls";
import { isOptedOut, loadRules, normalizeEmail, unsubscribeToken, type NotificationRules } from "./close-plan-notify-rules";
import { sendWithResend } from "./email";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : [];

// Internal links (colleagues) use APP_URL; customer links use CLOSEPLAN_URL when it is set (app/lib/close-plan-urls.ts). The unsubscribe page is public, so it
// lives on the customer address for everyone.
export const appBase = internalBase;
export const unsubscribeUrl = (email: string, base?: string) => `${customerBase(base)}/unsubscribe/${unsubscribeToken(email)}`;

// Open shared tasks a customer contact owns or works on, soonest first.
export function waitingTasks(data: Obj, personId: string, today = new Date().toISOString().slice(0, 10)): PlanEmailTask[] {
  const tasks = arr(data.tasks);
  return tasks
    .filter(t => t.status !== "Closed" && isShared(t, tasks) && (t.owner === personId || strs(t.coworkers).includes(personId)))
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")))
    .map(t => ({ title: String(t.title || ""), due: typeof t.due === "string" ? t.due : null, overdue: typeof t.due === "string" && t.due < today, description: typeof t.desc === "string" ? t.desc.slice(0, 400) : undefined, status: typeof t.status === "string" ? t.status : undefined }));
}

// The invitation reminder: only for a link nobody has opened, after the configured days since the last email, at most
// maxReminders times, and never above the weekly cap of scheduled emails to this person on this plan.
export function reminderDue(input: { lastSentAt: Date; reminders: number; opened: boolean; rules: NotificationRules["invitation"]; scheduledLastWeek: number; cap: number; now?: Date }): boolean {
  const { rules } = input, now = input.now || new Date();
  if (!rules.email || rules.reminderAfterDays <= 0 || rules.maxReminders <= 0) return false;
  if (input.opened || input.reminders >= rules.maxReminders || input.scheduledLastWeek >= input.cap) return false;
  return now.getTime() - input.lastSentAt.getTime() >= rules.reminderAfterDays * 86400000;
}

export async function logEmail(kind: string, planId: string, personId: string, email: string, taskId?: string) {
  await getDb().insert(closePlanEmailLog).values({ kind, planId, personId, email: normalizeEmail(email), taskId: taskId ?? null });
}

export type InviteResult = { sent: boolean; url: string; reason?: string };

// Creates a fresh personal link for a customer contact and emails it (earlier links keep working). The link is returned
// even when no email goes out (switched off, opted out, no address, no sending configured), so it can still be copied.
export async function sendInvitation(input: { plan: { id: string; title: string; data: Obj }; personId: string; fromName: string; createdBy: number | null; kind: "invitation" | "invitation_reminder"; baseUrl?: string }): Promise<InviteResult> {
  const { plan, personId } = input;
  const person = customerPerson(plan.data, personId);
  if (!person) throw new Error("Not a customer contact on this plan");
  const { token } = await createPlanLink(plan.id, personId, input.createdBy);
  const url = `${customerBase(input.baseUrl)}/p/${token}`;
  const email = typeof person.email === "string" ? normalizeEmail(person.email) : "";
  const rules = await loadRules();
  if (!rules.invitation.email) return { sent: false, url, reason: "Invitation emails are switched off under Admin → Notifications." };
  if (!email) return { sent: false, url, reason: "This contact has no email address." };
  if (person.noEmail === true || await isOptedOut(email)) return { sent: false, url, reason: "This person asked not to get Close Plan emails." };
  const first = String(person.name || "").split(/\s+/)[0] || "there";
  const mail = renderInvitation({ firstName: first, fromName: input.fromName, planTitle: plan.title, url, unsubscribeUrl: unsubscribeUrl(email, input.baseUrl), can: accessSummary(accessOf(person)), tasks: waitingTasks(plan.data, personId), reminder: input.kind === "invitation_reminder" });
  const result = await sendWithResend({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  if (!result.sent) return { sent: false, url, reason: result.reason || "The email could not be sent." };
  await logEmail(input.kind, plan.id, personId, email);
  return { sent: true, url };
}

// ---- Someone is added to the iSEEit team of a plan ----
export type NewMember = { id: string; name: string; email: string; role: string; noEmail?: boolean };
// People on the iSEEit side that the new version has and the old one did not (matched by email), without whoever made the change.
export function newInternalMembers(oldData: Obj | null | undefined, newData: Obj, actorEmail: string): NewMember[] {
  const had = new Set(arr(oldData?.people).filter(p => p.side === "seller").map(p => normalizeEmail(p.email)).filter(Boolean));
  const me = normalizeEmail(actorEmail);
  return arr(newData.people).filter(p => p.side === "seller" && typeof p.email === "string" && normalizeEmail(p.email) && !had.has(normalizeEmail(p.email)) && normalizeEmail(p.email) !== me && !p.sfdcUserId)
    .map(p => ({ id: String(p.id), name: String(p.name || ""), email: normalizeEmail(p.email), role: String(p.role || ""), noEmail: p.noEmail === true }));
}

export async function notifyAddedToPlan(input: { plan: { id: string; title: string }; members: NewMember[]; byName: string; baseUrl?: string }): Promise<void> {
  try {
    const rules = await loadRules();
    if (!rules.addedToPlan.internalEmail && !rules.addedToPlan.internalSlack) return;
    const url = `${appBase(input.baseUrl)}/close-plans`;
    for (const m of input.members) {
      if (rules.addedToPlan.internalEmail && !m.noEmail && !(await isOptedOut(m.email))) {
        const mail = renderAddedToPlan({ firstName: m.name.split(/\s+/)[0] || "there", byName: input.byName, planTitle: input.plan.title, role: m.role, url, unsubscribeUrl: unsubscribeUrl(m.email, input.baseUrl) });
        const r = await sendWithResend({ to: m.email, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => ({ sent: false }));
        if (r.sent) await logEmail("added_to_plan", input.plan.id, m.id, m.email);
      }
      if (rules.addedToPlan.internalSlack) await slackDirect(m.email, `👋 ${input.byName} added you to the close plan *${input.plan.title}*${m.role ? ` as ${m.role}` : ""}. ${url}`);
    }
  } catch (error) { console.error("Close Plan added-to-plan notice failed:", error instanceof Error ? error.message : error); }
}

// A Slack DM to someone at this email address. Best effort: no Slack account, no token, or an API error never blocks anything.
export async function slackDirect(email: string, text: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN; if (!token) return false;
  try {
    const { lookupSlackUserByEmail, openDirectMessage, postMessage } = await import("./slack");
    const id = await lookupSlackUserByEmail(token, email); if (!id) return false;
    const channel = await openDirectMessage(token, id); if (!channel) return false;
    await postMessage(token, { channel, text });
    return true;
  } catch (error) { console.error(`Close Plan Slack message failed for ${email}:`, error instanceof Error ? error.message : error); return false; }
}

// ---- Reminder bookkeeping for the daily job ----
export async function invitationHistory(planId: string, personId: string): Promise<{ lastSentAt: Date | null; reminders: number; opened: boolean; scheduledLastWeek: number }> {
  const db = getDb();
  const rows = await db.select().from(closePlanEmailLog).where(and(eq(closePlanEmailLog.planId, planId), eq(closePlanEmailLog.personId, personId), inArray(closePlanEmailLog.kind, ["invitation", "invitation_reminder"]))).orderBy(desc(closePlanEmailLog.sentAt));
  const mine = await db.select({ lastUsedAt: closePlanLinks.lastUsedAt }).from(closePlanLinks).where(and(eq(closePlanLinks.planId, planId), eq(closePlanLinks.personId, personId)));
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const recent = await db.select({ id: closePlanEmailLog.id }).from(closePlanEmailLog).where(and(eq(closePlanEmailLog.planId, planId), eq(closePlanEmailLog.personId, personId), eq(closePlanEmailLog.kind, "invitation_reminder"), gte(closePlanEmailLog.sentAt, weekAgo)));
  return { lastSentAt: rows[0]?.sentAt ?? null, reminders: rows.filter(r => r.kind === "invitation_reminder").length, opened: mine.some(l => l.lastUsedAt), scheduledLastWeek: recent.length };
}
export type { Rendered };

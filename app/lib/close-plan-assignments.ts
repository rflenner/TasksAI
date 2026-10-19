// Tells people when a task is assigned to them (owner or coworker) in a close plan, following the rules under Admin →
// Notifications: iSEEit people by email and Slack, customer contacts by email (only once they have been invited, with a fresh
// personal link). The same save can assign several tasks to one person: that is one email. People who opted out, or are marked
// "Don't email", get no email; the person who made the change is never told about their own change.
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanEmailLog } from "../../db/schema";
import { renderAssigned, type AssignedTask } from "./close-plan-emails";
import { appBase, logEmail, slackDirect, unsubscribeUrl } from "./close-plan-invitations";
import { createPlanLink } from "./close-plan-links";
import { customerBase } from "./close-plan-urls";
import { isOptedOut, loadRules, normalizeEmail } from "./close-plan-notify-rules";
import { sendWithResend } from "./email";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : [];

export type Assignment = { personId: string; tasks: Array<AssignedTask & { taskId: string }> };

// Who became owner or coworker of which open task between the two versions of a plan. New tasks count with all their assignees.
export function assignmentChanges(oldData: Obj | null | undefined, newData: Obj, today = new Date().toISOString().slice(0, 10), ignoreNewTasks = false): Assignment[] {
  const before = new Map(arr(oldData?.tasks).map(t => [String(t.id), t]));
  const byPerson = new Map<string, Assignment["tasks"]>();
  for (const t of arr(newData.tasks)) {
    if (t.status === "Closed") continue;
    const old = before.get(String(t.id));
    if (!old && ignoreNewTasks) continue;
    const had = new Set([old?.owner, ...strs(old?.coworkers)].filter((x): x is string => typeof x === "string"));
    const now: Array<[string, "Owner" | "Coworker"]> = [];
    if (typeof t.owner === "string" && t.owner) now.push([t.owner, "Owner"]);
    for (const c of strs(t.coworkers)) now.push([c, "Coworker"]);
    for (const [personId, role] of now) {
      if (had.has(personId)) continue;
      const list = byPerson.get(personId) || [];
      if (!list.some(x => x.taskId === String(t.id))) list.push({ taskId: String(t.id), title: String(t.title || "Untitled"), due: typeof t.due === "string" ? t.due : null, overdue: typeof t.due === "string" && t.due < today, description: typeof t.desc === "string" ? t.desc.slice(0, 400) : undefined, status: typeof t.status === "string" ? t.status : undefined, role });
      byPerson.set(personId, list);
    }
  }
  return [...byPerson.entries()].map(([personId, tasks]) => ({ personId, tasks }));
}

// Don't tell the same person about the same task twice within a day (an owner flipping back and forth is one notice).
async function alreadyTold(planId: string, personId: string, taskIds: string[]): Promise<Set<string>> {
  const since = new Date(Date.now() - 86400000);
  const rows = await getDb().select({ taskId: closePlanEmailLog.taskId }).from(closePlanEmailLog).where(and(eq(closePlanEmailLog.planId, planId), eq(closePlanEmailLog.personId, personId), eq(closePlanEmailLog.kind, "assigned"), gte(closePlanEmailLog.sentAt, since)));
  return new Set(rows.map(r => r.taskId || "").filter(id => taskIds.includes(id)));
}

export async function notifyAssignments(input: { plan: { id: string; title: string; oldData: Obj | null; newData: Obj }; byName: string; actorEmail?: string | null; source: "closeplan" | "salesforce"; baseUrl?: string }): Promise<void> {
  try {
    const { plan } = input;
    // Plans still in draft (and brand-new ones) are being set up: nobody is told about the template's assignments.
    if (!plan.oldData || plan.newData.status === "draft") return;
    const rules = await loadRules();
    if (input.source === "salesforce" && !rules.updates.fromSalesforce) return;
    // Tasks that arrive from Salesforce are not announced one by one (a first sync could add dozens); a changed owner on a task that exists is.
    const changes = assignmentChanges(plan.oldData, plan.newData, undefined, input.source === "salesforce");
    if (!changes.length) return;
    const people = arr(plan.newData.people), actor = normalizeEmail(input.actorEmail || "");
    const planUrl = `${appBase(input.baseUrl)}/close-plans`;
    for (const change of changes) try {
      const person = people.find(p => p.id === change.personId); if (!person) continue;
      const email = typeof person.email === "string" ? normalizeEmail(person.email) : "";
      if (!email || email === actor) continue;
      const told = await alreadyTold(plan.id, change.personId, change.tasks.map(t => t.taskId));
      const tasks = change.tasks.filter(t => !told.has(t.taskId));
      if (!tasks.length) continue;
      const first = String(person.name || "").split(/\s+/)[0] || "there";
      const internal = person.side === "seller";
      const mayEmail = person.noEmail !== true && !(await isOptedOut(email));
      if (internal) {
        if (rules.assignment.internalEmail && mayEmail) {
          const mail = renderAssigned({ firstName: first, byName: input.byName, planTitle: plan.title, tasks, url: planUrl, unsubscribeUrl: unsubscribeUrl(email, input.baseUrl) });
          const r = await sendWithResend({ to: email, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => ({ sent: false }));
          if (r.sent) for (const t of tasks) await logEmail("assigned", plan.id, change.personId, email, t.taskId);
        }
        if (rules.assignment.internalSlack) await slackDirect(email, `📌 ${input.byName} assigned you ${tasks.length === 1 ? `*${tasks[0].title}*${tasks[0].due ? ` (due ${tasks[0].due})` : ""}` : `${tasks.length} tasks (${tasks.slice(0, 3).map(t => t.title).join(", ")}${tasks.length > 3 ? ", …" : ""})`} in the close plan *${plan.title}*. ${planUrl}`);
      } else if (person.side === "buyer" && rules.assignment.customerEmail && mayEmail) {
        // Customers are only emailed once they have been invited, and the email carries a fresh personal link.
        const status = (person.invite as Obj | undefined)?.status;
        if (status !== "invited" && status !== "active") continue;
        const { token } = await createPlanLink(plan.id, change.personId, null);
        const url = `${customerBase(input.baseUrl)}/p/${token}`;
        const mail = renderAssigned({ firstName: first, byName: input.byName, planTitle: plan.title, tasks, url, unsubscribeUrl: unsubscribeUrl(email, input.baseUrl) });
        const r = await sendWithResend({ to: email, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => ({ sent: false }));
        if (r.sent) for (const t of tasks) await logEmail("assigned", plan.id, change.personId, email, t.taskId);
      }
    } catch (error) { console.error(`Close Plan assignment notice for ${change.personId} failed:`, error instanceof Error ? error.message : error); }
  } catch (error) { console.error("Close Plan assignment notices failed:", error instanceof Error ? error.message : error); }
}

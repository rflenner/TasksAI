import { and, eq, isNull } from "drizzle-orm";
import { invitationHistory, reminderDue, sendInvitation } from "../app/lib/close-plan-invitations";
import { loadRules, normalizeEmail } from "../app/lib/close-plan-notify-rules";
import { customerPerson } from "../app/lib/close-plan-share";
import { getDb, getSql } from "../db";
import { closePlanDocuments, closePlanEmailLog } from "../db/schema";

// Runs daily (see render.yaml) as a Render Cron Job: reminds customer contacts who were invited by email but haven't opened
// their personal link yet. The rules (Admin → Notifications) decide whether, after how many days and how often; people who
// asked not to be emailed are skipped. Each reminder carries a fresh personal link (the first one keeps working too).
// TEST_EMAIL restricts a manual run to one address.
const rules = await loadRules();
const testEmail = normalizeEmail(process.env.TEST_EMAIL || "");
let sent = 0, checked = 0;
try {
  if (rules.invitation.email && rules.invitation.reminderAfterDays > 0 && rules.invitation.maxReminders > 0) {
    const invited = await getDb().selectDistinct({ planId: closePlanEmailLog.planId, personId: closePlanEmailLog.personId }).from(closePlanEmailLog).where(eq(closePlanEmailLog.kind, "invitation"));
    for (const { planId, personId } of invited) {
      const [plan] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, planId), isNull(closePlanDocuments.deletedAt))).limit(1);
      if (!plan) continue;
      const data = plan.data as Record<string, unknown>, person = customerPerson(data, personId);
      if (!person || person.noEmail === true || typeof person.email !== "string") continue;
      if (testEmail && normalizeEmail(person.email) !== testEmail) continue;
      checked++;
      const h = await invitationHistory(planId, personId);
      if (!h.lastSentAt || !reminderDue({ lastSentAt: h.lastSentAt, reminders: h.reminders, opened: h.opened, rules: rules.invitation, scheduledLastWeek: h.scheduledLastWeek, cap: rules.customerEmailCapPerWeek })) continue;
      const owner = (Array.isArray(data.people) ? data.people as Array<Record<string, unknown>> : []).find(p => p.id === (data.planOwners as { seller?: string } | undefined)?.seller);
      const r = await sendInvitation({ plan: { id: planId, title: plan.title, data }, personId, fromName: String(owner?.name || "Your iSEEit contact"), createdBy: null, kind: "invitation_reminder" });
      if (r.sent) sent++; else console.log(`No reminder to ${person.email}: ${r.reason}`);
    }
  }
  console.log(`Close Plan invitation reminders: ${sent} sent, ${checked} invitations checked.`);
} finally {
  await getSql().end();
}

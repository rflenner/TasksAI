// Close Plan notification rules, set by Site Admins under Admin → Notifications, and the list of people who asked
// not to get Close Plan emails. The senders (invitation, assignment, overdue, Monday digest, Slack) read the rules
// from here instead of hard-coding them. Pure parts (defaults, sanitizing, unsubscribe tokens) are unit-tested
// (tests/close-plan-notify-rules.test.ts); the database helpers below are thin.
//
// Guiding rule agreed 2026-10-01: never spam the client. Customers get at most customerEmailCapPerWeek scheduled
// emails per person per plan per week; internal (iSEEit) people keep Task AI's own cadence.
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanNotificationRules, notificationOptouts } from "../../db/schema";

export type NotificationRules = {
  // The "Send invitation" button emails the customer their personal link, and reminds them if they haven't opened it.
  invitation: { email: boolean; reminderAfterDays: number; maxReminders: number };
  // Someone on the iSEEit team is added to a plan.
  addedToPlan: { internalEmail: boolean; internalSlack: boolean };
  // Someone becomes owner or coworker of a task.
  assignment: { internalEmail: boolean; internalSlack: boolean; customerEmail: boolean };
  // Overdue tasks: iSEEit people get Task AI's reminder to owners every N days; customers only see them in the Monday email.
  overdue: { internalReminders: boolean; internalEveryDays: number; customersInMondayDigest: boolean };
  // The Monday email: plan overview for plan owners, "My tasks" and "Requested by you" for customers.
  digest: { monday: boolean; planOwners: boolean; customers: boolean; skipWhenNothingOpen: boolean };
  // Tasks someone asked for (Requested by): iSEEit people hear about updates and closes as they happen, customers in the Monday email.
  requestedBy: { internalRealtime: boolean; customersInDigest: boolean };
  // Slack messages to iSEEit people on updates and closes, and whether changes that arrive from Salesforce count like any other.
  updates: { internalSlack: boolean; fromSalesforce: boolean };
  // Never more than this many scheduled emails per customer per plan per week.
  customerEmailCapPerWeek: number;
};

export const DEFAULT_RULES: NotificationRules = {
  invitation: { email: true, reminderAfterDays: 3, maxReminders: 2 },
  addedToPlan: { internalEmail: true, internalSlack: true },
  assignment: { internalEmail: true, internalSlack: true, customerEmail: true },
  overdue: { internalReminders: true, internalEveryDays: 2, customersInMondayDigest: true },
  digest: { monday: true, planOwners: true, customers: true, skipWhenNothingOpen: true },
  requestedBy: { internalRealtime: true, customersInDigest: true },
  updates: { internalSlack: true, fromSalesforce: true },
  customerEmailCapPerWeek: 1,
};

const bool = (v: unknown, d: boolean) => typeof v === "boolean" ? v : d;
const int = (v: unknown, d: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };
const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

// Whatever comes in (a saved row, a request body) becomes a complete, in-range set of rules.
export function sanitizeRules(raw: unknown): NotificationRules {
  const r = obj(raw), d = DEFAULT_RULES;
  const inv = obj(r.invitation), add = obj(r.addedToPlan), asg = obj(r.assignment), od = obj(r.overdue), dg = obj(r.digest), rb = obj(r.requestedBy), up = obj(r.updates);
  return {
    invitation: { email: bool(inv.email, d.invitation.email), reminderAfterDays: int(inv.reminderAfterDays, d.invitation.reminderAfterDays, 0, 30), maxReminders: int(inv.maxReminders, d.invitation.maxReminders, 0, 5) },
    addedToPlan: { internalEmail: bool(add.internalEmail, d.addedToPlan.internalEmail), internalSlack: bool(add.internalSlack, d.addedToPlan.internalSlack) },
    assignment: { internalEmail: bool(asg.internalEmail, d.assignment.internalEmail), internalSlack: bool(asg.internalSlack, d.assignment.internalSlack), customerEmail: bool(asg.customerEmail, d.assignment.customerEmail) },
    overdue: { internalReminders: bool(od.internalReminders, d.overdue.internalReminders), internalEveryDays: int(od.internalEveryDays, d.overdue.internalEveryDays, 1, 14), customersInMondayDigest: bool(od.customersInMondayDigest, d.overdue.customersInMondayDigest) },
    digest: { monday: bool(dg.monday, d.digest.monday), planOwners: bool(dg.planOwners, d.digest.planOwners), customers: bool(dg.customers, d.digest.customers), skipWhenNothingOpen: bool(dg.skipWhenNothingOpen, d.digest.skipWhenNothingOpen) },
    requestedBy: { internalRealtime: bool(rb.internalRealtime, d.requestedBy.internalRealtime), customersInDigest: bool(rb.customersInDigest, d.requestedBy.customersInDigest) },
    updates: { internalSlack: bool(up.internalSlack, d.updates.internalSlack), fromSalesforce: bool(up.fromSalesforce, d.updates.fromSalesforce) },
    customerEmailCapPerWeek: int(r.customerEmailCapPerWeek, d.customerEmailCapPerWeek, 1, 7),
  };
}

export async function loadRules(): Promise<NotificationRules> {
  const [row] = await getDb().select().from(closePlanNotificationRules).where(eq(closePlanNotificationRules.id, "default")).limit(1);
  return sanitizeRules(row?.rules);
}
export async function saveRules(raw: unknown, userId: number | null): Promise<NotificationRules> {
  const rules = sanitizeRules(raw);
  await getDb().insert(closePlanNotificationRules).values({ id: "default", rules, updatedBy: userId })
    .onConflictDoUpdate({ target: closePlanNotificationRules.id, set: { rules, updatedBy: userId, updatedAt: new Date() } });
  return rules;
}

// ---- People who asked not to get Close Plan emails (by email address, case-insensitive). ----
export const normalizeEmail = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";
export const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

export async function optedOutEmails(): Promise<Set<string>> {
  return new Set((await getDb().select({ email: notificationOptouts.email }).from(notificationOptouts)).map(r => r.email));
}
export async function isOptedOut(email: string): Promise<boolean> {
  const [row] = await getDb().select({ email: notificationOptouts.email }).from(notificationOptouts).where(eq(notificationOptouts.email, normalizeEmail(email))).limit(1);
  return Boolean(row);
}
export async function addOptOut(email: string, source: "admin" | "self" | "plan", reason: string | null, userId: number | null) {
  const e = normalizeEmail(email); if (!isValidEmail(e)) return false;
  await getDb().insert(notificationOptouts).values({ email: e, source, reason: reason ? reason.slice(0, 300) : null, createdBy: userId }).onConflictDoNothing();
  return true;
}
export async function removeOptOut(email: string) { await getDb().delete(notificationOptouts).where(eq(notificationOptouts.email, normalizeEmail(email))); }

// Every Close Plan email carries an unsubscribe link: /unsubscribe/<token>, signed so only the sender can create one.
const secret = () => process.env.SESSION_SECRET || "";
export function unsubscribeToken(email: string): string {
  const e = Buffer.from(normalizeEmail(email)).toString("base64url");
  return `${e}.${createHmac("sha256", secret()).update(`unsubscribe:${e}`).digest("base64url").slice(0, 32)}`;
}
export function emailFromUnsubscribeToken(token: string): string | null {
  if (!secret()) return null;
  const [e, sig] = String(token).split(".");
  if (!e || !sig) return null;
  const expected = createHmac("sha256", secret()).update(`unsubscribe:${e}`).digest("base64url").slice(0, 32);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const email = Buffer.from(e, "base64url").toString("utf8");
  return isValidEmail(email) ? email : null;
}
// A sender asks this before every email: people who opted out are skipped, whatever the rules say.
export const mayEmail = (email: string, optedOut: Set<string>) => isValidEmail(normalizeEmail(email)) && !optedOut.has(normalizeEmail(email));

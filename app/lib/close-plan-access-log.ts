// A log of who logged in or opened a Close Plan (the iSEEit team signed in, customers on their personal link), what they viewed
// and what they changed. Readable by site admins only (Admin → Close Plan activity, /close-plan-activity). Writing never blocks or
// fails the request that caused it. Rows older than a year are removed now and then. Pure parts are tested in
// tests/close-plan-access-log.test.ts.
import { and, desc, eq, gt, ilike, inArray, lt, max, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanAccessLog, closePlanLinks, sessions, users } from "../../db/schema";

type Obj = Record<string, unknown>;
export const EVENTS = {
  login: "Signed in", plan_opened: "Opened the plan", task_opened: "Opened a task", file_viewed: "Viewed a file", file_downloaded: "Downloaded a file",
  file_added: "Added a file", file_removed: "Removed a file", changes_saved: "Changed the plan",
} as const;
export type AccessEvent = keyof typeof EVENTS;
export const CLIENT_EVENTS: AccessEvent[] = ["plan_opened", "task_opened"];
const KEEP_DAYS = 365;

export type AccessEntry = {
  event: AccessEvent; side: "seller" | "buyer"; via: "app" | "link"; personName: string; userId?: number | null; personId?: string | null;
  plan?: { id: string; title?: unknown } | null; task?: { id: string; title?: unknown } | null; detail?: string | null;
  // Skip the entry when the same person did the same thing on the same plan (and task) within this many minutes.
  dedupeMinutes?: number;
};

const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const taskTitleOf = (data: Obj, id: string) => { const t = arr(data.tasks).find(x => x.id === id); return t ? cut(t.title, 200) : null; };

// ---- what changed between two versions of a plan (pure) ----
const TASK_FIELDS: Array<[string, string]> = [["title", "renamed"], ["desc", "edited the description"], ["status", "status"], ["due", "due date"], ["owner", "owner"], ["coworkers", "coworkers"], ["recipients", "requested by"], ["shared", "visibility"], ["milestone", "milestone"], ["phase", "phase"]];
export type ChangeSummary = { taskId: string | null; taskTitle: string | null; detail: string };

// A short, readable summary of what a save changed, or null when nothing that matters did (sync bookkeeping, activity text).
export function describeChanges(prev: Obj, next: Obj): ChangeSummary | null {
  const prevTasks = arr(prev.tasks), nextTasks = arr(next.tasks), before = new Map(prevTasks.map(t => [t.id, t]));
  const people = new Map(arr(next.people).map(p => [p.id, cut(p.name, 60)]));
  const parts: string[] = [], touched: Obj[] = [];
  for (const t of nextTasks) {
    const old = before.get(t.id), title = `“${cut(t.title, 60)}”`;
    if (!old) { parts.push(`added ${title}`); touched.push(t); continue; }
    const what: string[] = [];
    for (const [f, label] of TASK_FIELDS) {
      if (same(old[f], t[f])) continue;
      if (f === "status") what.push(`status ${cut(old.status, 20)} → ${cut(t.status, 20)}`);
      else if (f === "owner") what.push(`owner → ${people.get(t.owner as string) || "someone"}`);
      else if (f === "due") what.push(t.due ? `due ${cut(t.due, 10)}` : "due date removed");
      else what.push(label);
    }
    if (arr(t.updates).length > arr(old.updates).length) what.push("posted an update");
    if (what.length) { parts.push(`${title}: ${what.join(", ")}`); touched.push(t); }
  }
  const nextIds = new Set(nextTasks.map(t => t.id));
  for (const t of prevTasks) if (!nextIds.has(t.id)) { parts.push(`deleted “${cut(t.title, 60)}”`); touched.push(t); }
  const plan: string[] = [];
  if (!same(prev.title, next.title)) plan.push("title");
  if (!same(arr(prev.phases).map(p => [p.id, p.name, p.start, p.end]), arr(next.phases).map(p => [p.id, p.name, p.start, p.end]))) plan.push("phases");
  if (!same(arr(prev.people).map(p => [p.id, p.name, p.role, p.email, p.side]), arr(next.people).map(p => [p.id, p.name, p.role, p.email, p.side]))) plan.push("people");
  if (!same(prev.planOwners, next.planOwners)) plan.push("plan owners");
  if (plan.length) parts.push(`plan ${plan.join(", ")}`);
  if (!parts.length) return null;
  const shown = parts.slice(0, 6), more = parts.length - shown.length;
  const one = touched.length === 1 && !plan.length ? touched[0] : null;
  return { taskId: one ? cut(one.id, 64) : null, taskTitle: one ? cut(one.title, 200) : null, detail: cut(shown.join("; ") + (more > 0 ? `; and ${more} more` : ""), 900) };
}

// ---- writing ----
export async function logAccess(e: AccessEntry): Promise<void> {
  try {
    const db = getDb(), planId = e.plan?.id ?? null, taskId = e.task?.id ?? null;
    if (e.dedupeMinutes) {
      const who = e.userId ? eq(closePlanAccessLog.userId, e.userId) : e.personId ? eq(closePlanAccessLog.personId, e.personId) : sql`false`;
      const [hit] = await db.select({ id: closePlanAccessLog.id }).from(closePlanAccessLog).where(and(
        who, eq(closePlanAccessLog.event, e.event), planId ? eq(closePlanAccessLog.planId, planId) : sql`${closePlanAccessLog.planId} is null`,
        taskId ? eq(closePlanAccessLog.taskId, taskId) : sql`${closePlanAccessLog.taskId} is null`, gt(closePlanAccessLog.at, new Date(Date.now() - e.dedupeMinutes * 60000)))).limit(1);
      if (hit) return;
    }
    await db.insert(closePlanAccessLog).values({
      planId, planTitle: e.plan?.title ? cut(e.plan.title, 200) : null, userId: e.userId ?? null, personId: e.personId ?? null, personName: cut(e.personName, 120) || "Unknown",
      side: e.side, via: e.via, event: e.event, taskId, taskTitle: e.task?.title ? cut(e.task.title, 200) : null, detail: e.detail ? cut(e.detail, 900) : null,
    });
    if (Math.random() < 0.005) await db.delete(closePlanAccessLog).where(lt(closePlanAccessLog.at, new Date(Date.now() - KEEP_DAYS * 86400000)));
  } catch (error) { console.error("close plan access log", error); }
}

// ---- reading (admin page) ----
export type AccessFilters = { plan?: string; who?: string; event?: string; sinceDays?: number; before?: number; limit?: number };
export async function listAccess(f: AccessFilters) {
  const limit = Math.min(Math.max(f.limit || 100, 1), 200), c = closePlanAccessLog;
  const where = and(
    f.plan ? eq(c.planId, f.plan) : undefined, f.who ? ilike(c.personName, `%${f.who.replace(/[%_\\]/g, m => "\\" + m)}%`) : undefined,
    f.event && f.event in EVENTS ? eq(c.event, f.event) : undefined, f.sinceDays ? gt(c.at, new Date(Date.now() - f.sinceDays * 86400000)) : undefined, f.before ? lt(c.id, f.before) : undefined);
  const rows = await getDb().select().from(c).where(where).orderBy(desc(c.id)).limit(limit + 1);
  return { rows: rows.slice(0, limit).map(r => ({ ...r, at: r.at.toISOString() })), hasMore: rows.length > limit };
}
export async function accessPlans() {
  const c = closePlanAccessLog;
  const rows = await getDb().select({ id: c.planId, title: sql<string>`max(${c.planTitle})` }).from(c).where(sql`${c.planId} is not null`).groupBy(c.planId).orderBy(sql`max(${c.planTitle})`);
  return rows.filter(r => r.id).map(r => ({ id: r.id as string, title: r.title || r.id as string }));
}

// When each person on a plan was last seen: the iSEEit team by their latest Task AI activity (a session, or something logged),
// customers by the last use of their personal link. Keys are person ids; null means never.
export async function lastSeen(planId: string, data: Obj): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}, db = getDb();
  const people = arr(data.people);
  for (const p of people) out[String(p.id)] = null;
  const emails = people.filter(p => p.side === "seller" && typeof p.email === "string" && p.email).map(p => String(p.email).trim().toLowerCase());
  if (emails.length) {
    const found = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(sql`lower(${users.email})`, emails));
    const ids = found.map(u => u.id);
    if (ids.length) {
      const seen = new Map<number, Date>();
      const bump = (id: number | null, d: Date | null) => { if (id && d && (!seen.get(id) || d > seen.get(id)!)) seen.set(id, d); };
      for (const r of await db.select({ id: sessions.userId, at: max(sessions.lastSeenAt) }).from(sessions).where(inArray(sessions.userId, ids)).groupBy(sessions.userId)) bump(r.id, r.at);
      for (const r of await db.select({ id: closePlanAccessLog.userId, at: max(closePlanAccessLog.at) }).from(closePlanAccessLog).where(inArray(closePlanAccessLog.userId, ids)).groupBy(closePlanAccessLog.userId)) bump(r.id, r.at);
      for (const p of people) {
        const u = found.find(x => x.email.toLowerCase() === String(p.email || "").trim().toLowerCase()), d = u && seen.get(u.id);
        if (p.side === "seller" && d) out[String(p.id)] = d.toISOString();
      }
    }
  }
  for (const r of await db.select({ person: closePlanLinks.personId, at: max(closePlanLinks.lastUsedAt) }).from(closePlanLinks).where(eq(closePlanLinks.planId, planId)).groupBy(closePlanLinks.personId))
    if (r.at && r.person in out) out[r.person] = r.at.toISOString();
  return out;
}

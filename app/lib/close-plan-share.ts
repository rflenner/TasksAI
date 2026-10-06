// Close Plan personal links for customer contacts: what a contact sees and what
// they may change. Pure and DB-free so the rules are unit-tested
// (tests/close-plan-share.test.ts); app/lib/close-plan-links.ts and the routes
// in app/api/close-plans/shared do the reading and writing.
//
// The plan is stored whole as JSON (step A). A customer never receives the
// stored document: customerView builds a filtered copy on the server, and their
// changes come back as a list of tasks plus new activity entries that
// applyCustomerChanges checks one by one against their access rights.

type Obj = Record<string, unknown>;
export type Access = { level: "view" | "own" | "all"; create: boolean };
export type CustomerChanges = { tasks?: unknown; deleted?: unknown; activity?: unknown };

export const STATUSES = ["Open", "In progress", "Closed"] as const;
const MAX_TITLE = 300, MAX_TEXT = 20_000, MAX_UPDATE = 10_000, MAX_ACTIVITY_TEXT = 500, MAX_TASKS_PER_SAVE = 200, ACTIVITY_KEEP = 40;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const arr = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") as Obj[] : [];
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : [];
const str = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function customerPerson(data: Obj, personId: string): Obj | null {
  return arr(data.people).find(p => p.id === personId && p.side === "buyer") || null;
}

export function accessOf(person: Obj): Access {
  const a = (person.access || {}) as Obj;
  const level = a.level === "view" || a.level === "all" ? a.level : "own";
  return { level, create: level !== "view" && a.create !== false };
}

// Shared tasks only, and a subtask only when its main task is shared too: the same rule as the page's visible().
export function isShared(task: Obj, tasks: Obj[]): boolean {
  if (task.shared === false) return false;
  if (!task.parent) return true;
  const parent = tasks.find(t => t.id === task.parent);
  return Boolean(parent) && parent!.shared !== false;
}

const onTask = (t: Obj, id: string) => t.owner === id || strs(t.coworkers).includes(id) || t.createdBy === id;
export const canEditTask = (t: Obj, id: string, a: Access) => a.level === "all" || (a.level === "own" && onTask(t, id));
export const canUpdateTask = (t: Obj, id: string, a: Access) => a.level !== "view" && (canEditTask(t, id, a) || strs(t.recipients).includes(id));

// The plan as a customer contact sees it: no internal tasks (or activity about them), no deal data from Sales AI,
// no internal setup state, and iSEEit people without their email address. Returns null when the person isn't a
// customer contact on the plan (any more).
export function customerView(data: Obj, personId: string): Obj | null {
  if (!customerPerson(data, personId)) return null;
  const tasks = arr(data.tasks);
  const shown = tasks.filter(t => isShared(t, tasks));
  const ids = new Set(shown.map(t => t.id));
  const people = arr(data.people).map(p => {
    const { id, name, title, role, side, access, invite, email } = p;
    return { id, name, title, role, side, access, invite: invite ? { status: (invite as Obj).status } : undefined, ...(side === "buyer" ? { email } : {}) };
  });
  const activity = arr(data.activity).filter(a => !a.task || ids.has(a.task));
  return { id: data.id, title: data.title, account: data.account, status: data.status, planOwners: data.planOwners, phases: arr(data.phases), tasks: shown, people, activity };
}

const validStatus = (v: unknown) => (STATUSES as readonly string[]).includes(v as string);
const validDue = (v: unknown) => v === null || v === "" || (typeof v === "string" && DATE.test(v));

// New entries a customer appends to a list (status updates, date changes): only what goes beyond the stored list,
// only entries in their own name, with the text cut to size.
function appended(stored: unknown, incoming: unknown, personId: string, text: "text" | null): Obj[] {
  const before = arr(stored).length;
  return arr(incoming).slice(before).filter(e => e.by === personId).map(e => text
    ? { by: personId, at: str(e.at, 10), text: str(e.text, MAX_UPDATE), ...(e.viaEmail ? { viaEmail: true } : {}) }
    : { by: personId, at: str(e.at, 10), from: str(e.from, 10), to: str(e.to, 10) })
    .filter(e => text ? (e as Obj).text : true);
}

export type ApplyResult = { data: Obj; applied: number; ignored: number };

// Applies a customer's changes to the stored plan. Every field is checked against the person's rights on that
// task; anything they may not change is skipped (counted in `ignored`), never an error, so one stale field
// doesn't lose the rest of the save. People, phases, plan owners and the internal/shared flag are never changed.
export function applyCustomerChanges(data: Obj, personId: string, changes: CustomerChanges, today: string): ApplyResult {
  const person = customerPerson(data, personId);
  if (!person) throw new Error("not a customer contact on this plan");
  const access = accessOf(person);
  const plan = JSON.parse(JSON.stringify(data)) as Obj;
  const tasks = arr(plan.tasks);
  const peopleIds = new Set(arr(plan.people).map(p => p.id));
  const phaseIds = new Set(arr(plan.phases).map(p => p.id));
  const validPerson = (v: unknown) => typeof v === "string" && peopleIds.has(v);
  const validPeople = (v: unknown) => Array.isArray(v) && v.every(validPerson);
  let applied = 0, ignored = 0;
  const started = new Set<string>();

  const incoming = arr(changes.tasks).slice(0, MAX_TASKS_PER_SAVE);
  for (const x of incoming) {
    const id = x.id;
    if (typeof id !== "string" || !ID.test(id)) { ignored++; continue; }
    const t = tasks.find(y => y.id === id);
    if (t) {
      if (!isShared(t, tasks) || !canUpdateTask(t, personId, access)) { ignored++; continue; }
      const edit = canEditTask(t, personId, access);
      const was = t.status;
      const set = (field: string, ok: boolean, value: unknown) => {
        if (same(t[field], x[field]) || x[field] === undefined) return;
        if (ok) { t[field] = value; applied++; } else ignored++;
      };
      set("status", validStatus(x.status), x.status);
      if (t.status !== was) t.closedAt = t.status === "Closed" ? (was === "Closed" ? t.closedAt : today) : null;
      set("title", edit && typeof x.title === "string" && x.title.trim() !== "", str(x.title, MAX_TITLE));
      set("desc", edit && typeof x.desc === "string", str(x.desc, MAX_TEXT));
      set("due", edit && validDue(x.due), x.due || null);
      set("owner", edit && validPerson(x.owner), x.owner);
      set("coworkers", edit && validPeople(x.coworkers), x.coworkers);
      set("recipients", edit && validPeople(x.recipients), x.recipients);
      const notes = appended(t.updates, x.updates, personId, "text");
      if (notes.length) { t.updates = [...arr(t.updates), ...notes]; applied += notes.length; }
      const moves = edit ? appended(t.dateChanges, x.dateChanges, personId, null) : [];
      if (moves.length) { t.dateChanges = [...arr(t.dateChanges), ...moves]; applied += moves.length; }
      if (notes.length || (was === "Open" && t.status !== "Open")) started.add(id);
      continue;
    }
    // A new task or subtask.
    const parent = x.parent ? tasks.find(y => y.id === x.parent) : null;
    const ok = access.create && typeof x.title === "string" && x.title.trim() !== ""
      && (x.parent ? Boolean(parent) && isShared(parent!, tasks) : true)
      && phaseIds.has(parent ? parent.phase : x.phase);
    if (!ok) { ignored++; continue; }
    const status = validStatus(x.status) ? x.status : "Open";
    tasks.push({
      id, phase: parent ? parent.phase : x.phase, parent: parent ? parent.id : null, title: str(x.title, MAX_TITLE),
      desc: typeof x.desc === "string" ? str(x.desc, MAX_TEXT) : undefined,
      owner: validPerson(x.owner) ? x.owner : personId, due: validDue(x.due) ? x.due || null : null, status,
      closedAt: status === "Closed" ? today : null, shared: true, createdBy: personId,
      coworkers: validPeople(x.coworkers) ? x.coworkers : [], recipients: validPeople(x.recipients) ? x.recipients : [],
      updates: appended([], x.updates, personId, "text"),
    });
    applied++;
    if (parent && status !== "Open") started.add(id);
  }

  // Deleting: only tasks the contact added themselves (with every subtask theirs too), never anyone else's.
  for (const id of strs(changes.deleted).slice(0, 50)) {
    const t = tasks.find(y => y.id === id);
    if (!t || !isShared(t, tasks) || !access.create || t.createdBy !== personId || tasks.some(k => k.parent === id && k.createdBy !== personId)) { ignored++; continue; }
    const gone = new Set([id, ...tasks.filter(k => k.parent === id).map(k => k.id)]);
    for (let i = tasks.length - 1; i >= 0; i--) if (gone.has(tasks[i].id)) tasks.splice(i, 1);
    applied++;
  }

  // Work on a task (an update, or leaving Open) starts its main task too: the page's startWork rule, applied here
  // so it holds even where the contact may not edit the main task.
  for (const id of started) {
    for (let t = tasks.find(y => y.id === id), guard = 0; t && guard < 5; guard++) {
      const parent = t.parent ? tasks.find(y => y.id === t!.parent) : null;
      if (parent && parent.status === "Open") parent.status = "In progress";
      t = parent || undefined;
    }
  }

  const shownIds = new Set(tasks.filter(t => isShared(t, tasks)).map(t => t.id));
  const entries = arr(changes.activity).slice(0, 20)
    .filter(a => typeof a.text === "string" && a.text.trim() && (!a.task || shownIds.has(a.task)))
    .map(a => ({ at: today, by: personId, text: str(a.text, MAX_ACTIVITY_TEXT), task: a.task || null }));
  plan.activity = [...entries, ...arr(plan.activity)].slice(0, ACTIVITY_KEEP);
  plan.tasks = tasks;
  return { data: plan, applied: applied + entries.length, ignored };
}

// First visit through a personal link marks the invitation as opened, as the People tab shows it.
export function markOpened(data: Obj, personId: string, today: string): Obj | null {
  const p = customerPerson(data, personId);
  if (!p || (p.invite as Obj | undefined)?.status === "active") return null;
  const plan = JSON.parse(JSON.stringify(data)) as Obj;
  const q = customerPerson(plan, personId)!;
  q.invite = { ...((q.invite as Obj) || {}), status: "active", openedAt: today };
  return plan;
}

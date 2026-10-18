// Close Plan ⇄ Salesforce: links a plan to its opportunity's iSEEit close plan
// (iseeit__Current_Phase__c phases, iseeit__TO_DO__c checkpoints) and works out
// what to pull, push and create. Pure and DB-free (tests/close-plan-sfdc-sync.test.ts);
// app/api/close-plans/store/[id]/sfdc-sync does the fetching, writing and saving.
//
// Every linked task keeps `sfdcSeen`: the values (already in Close Plan terms) as of
// the last sync. Per field: only Salesforce changed → pull; only the plan changed →
// push; both changed to different values → the PLAN WINS and the overwritten
// Salesforce value is noted in the activity (docs/close-plan-salesforce.md).
import { isSalesforceId, MAX_DESCRIPTION_LENGTH } from "./salesforce-checkpoints";

export type SfPhaseRow = { Id: string; iseeit__Title__c?: string | null; iseeit__Phase_Order__c?: string | number | null; iseeit__Start_Date__c?: string | null; iseeit__End_Date__c?: string | null };
export type SfCheckpointRow = {
  Id: string; iseeit__Title__c?: string | null; iseeit__Current_Phase__c?: string | null; iseeit__Phase_Checkpoint_Status__c?: string | null;
  iseeit__Status__c?: boolean | null; iseeit__Deadline__c?: string | null; iseeit__Interaction_Type__c?: string | null;
  iseeit__Phase_Checkpoint_Owner__c?: string | null; iseeit__Checklist_Description__c?: string | null; iseeit__Checkpoint_N_A__c?: boolean | null;
};

type Person = { id: string; name?: string; email?: string; title?: string; side?: string; role?: string; access?: object; invite?: object; sfdcUserId?: string; sfdcContactId?: string };
type Phase = { id: string; name?: string; goal?: string; start?: string; end?: string; sfdcId?: string };
export type Seen = { title: string; desc: string; status: string; due: string | null; shared: boolean; owners: string; planOwners?: string };
type Task = { id: string; phase: string; parent: string | null; title: string; desc?: string; owner: string; coworkers?: string[]; due?: string; status: string; shared: boolean; sfdcId?: string; sfdcSeen?: Seen; sfdcSkip?: boolean; [k: string]: unknown };
export type SyncPlan = {
  people: Person[]; phases: Phase[]; tasks: Task[]; seq?: number;
  activity?: { at: string; by: string; text: string; task: string | null }[];
  planOwners?: { seller?: string | null; buyer?: string | null };
  sfdc?: { opportunityId?: string; syncedAt?: string };
  [k: string]: unknown;
};

export const SFDC_AUTHOR = "sfdc";

// Salesforce field values for one checkpoint (a PATCH, or a POST with the create fields added).
export type SfFields = Record<string, string | boolean | null>;
export type Update = { taskId: string; sfdcId: string; fields: SfFields; seen: Seen };
export type Create = { taskId: string; fields: SfFields; seen: Seen };
export type SyncOutcome = {
  plan: SyncPlan;                 // pulls applied; pushes not yet recorded in sfdcSeen (see commit)
  updates: Update[]; creates: Create[];
  pulled: string[]; pushed: string[]; conflicts: string[]; skipped: string[];
  unlinked: number;               // plan tasks that exist only here, held back on the first sync
};

export const checkpointQuery = (opportunityId: string) => {
  if (!isSalesforceId(opportunityId)) throw new Error("Invalid Salesforce opportunity id");
  return "SELECT Id, iseeit__Title__c, iseeit__Current_Phase__c, iseeit__Phase_Checkpoint_Status__c, iseeit__Status__c, iseeit__Deadline__c, " +
    "iseeit__Interaction_Type__c, iseeit__Phase_Checkpoint_Owner__c, iseeit__Checklist_Description__c, iseeit__Checkpoint_N_A__c " +
    `FROM iseeit__TO_DO__c WHERE iseeit__Opportunity__c = '${opportunityId}' AND iseeit__Is_From_Close_Plan__c = true AND iseeit__Current_Phase__c != null ` +
    "ORDER BY iseeit__Close_Plan_Order__c NULLS LAST";
};
export const phaseQuery = (opportunityId: string) => {
  if (!isSalesforceId(opportunityId)) throw new Error("Invalid Salesforce opportunity id");
  return "SELECT Id, iseeit__Title__c, iseeit__Phase_Order__c, iseeit__Start_Date__c, iseeit__End_Date__c " +
    `FROM iseeit__Current_Phase__c WHERE iseeit__Opportunity__c = '${opportunityId}' ORDER BY iseeit__Phase_Order__c`;
};

// iSEEit status ⇄ Close Plan status. "Due" and empty count as Open.
export const statusFromSfdc = (status?: string | null, done?: boolean | null) => status === "Done" || (!status && done) ? "Closed" : status === "In Progress" ? "In progress" : "Open";
export const statusToSfdc = (status: string) => status === "Closed" ? "Done" : status === "In progress" ? "In Progress" : "Open";
// Only "Internal" is hidden from the customer.
export const sharedFromSfdc = (interaction?: string | null) => interaction !== "Internal";

const ownerList = (s?: string | null) => (s || "").split(",").map(x => x.trim()).filter(Boolean);

function seenOf(row: SfCheckpointRow): Seen {
  return {
    title: (row.iseeit__Title__c || "").trim(), desc: row.iseeit__Checklist_Description__c || "",
    status: statusFromSfdc(row.iseeit__Phase_Checkpoint_Status__c, row.iseeit__Status__c), due: row.iseeit__Deadline__c || null,
    shared: sharedFromSfdc(row.iseeit__Interaction_Type__c), owners: ownerList(row.iseeit__Phase_Checkpoint_Owner__c).join(","),
  };
}

export function fieldsFor(t: Pick<Seen, "title" | "desc" | "status" | "due" | "shared">, only?: Array<keyof Seen>): SfFields {
  const all: SfFields = {
    iseeit__Title__c: t.title.slice(0, 255), iseeit__Checklist_Description__c: t.desc.slice(0, MAX_DESCRIPTION_LENGTH),
    iseeit__Phase_Checkpoint_Status__c: statusToSfdc(t.status), iseeit__Status__c: t.status === "Closed",
    iseeit__Deadline__c: t.due, iseeit__Interaction_Type__c: t.shared ? "Mutual" : "Internal",
  };
  if (!only) return all;
  const groups: Record<string, string[]> = { title: ["iseeit__Title__c"], desc: ["iseeit__Checklist_Description__c"], status: ["iseeit__Phase_Checkpoint_Status__c", "iseeit__Status__c"], due: ["iseeit__Deadline__c"], shared: ["iseeit__Interaction_Type__c"] };
  return Object.fromEntries(only.flatMap(k => (groups[k] || []).map(f => [f, all[f]])));
}

const dateOf = (d: string | null | undefined) => d || null;

export function syncPlan(input: SyncPlan, phaseRows: SfPhaseRow[], rows: SfCheckpointRow[], opts: { sendUnlinked?: boolean; today?: string } = {}): SyncOutcome {
  const plan: SyncPlan = structuredClone(input);
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const first = !plan.sfdc?.syncedAt;
  const out: SyncOutcome = { plan, updates: [], creates: [], pulled: [], pushed: [], conflicts: [], skipped: [], unlinked: 0 };
  const activity: NonNullable<SyncPlan["activity"]> = [];
  const note = (text: string, task: string | null) => activity.push({ at: today, by: SFDC_AUTHOR, text, task });
  const lc = (s?: string) => (s || "").trim().toLowerCase();

  // Phases: link by Salesforce id, else by name; Salesforce phases the plan lacks are added.
  for (const row of phaseRows) {
    let phase = plan.phases.find(p => p.sfdcId === row.Id) || plan.phases.find(p => !p.sfdcId && lc(p.name) === lc(row.iseeit__Title__c || ""));
    if (phase) { phase.sfdcId = row.Id; continue; }
    phase = { id: "sf" + row.Id.slice(-6), name: row.iseeit__Title__c || "Phase", goal: "", start: row.iseeit__Start_Date__c || today, end: row.iseeit__End_Date__c || row.iseeit__Start_Date__c || today, sfdcId: row.Id };
    plan.phases.push(phase);
    note(`added the phase “${phase.name}” from Salesforce`, null); out.pulled.push(`phase “${phase.name}”`);
  }
  const phaseBySfdc = new Map(plan.phases.filter(p => p.sfdcId).map(p => [p.sfdcId as string, p]));
  const personBySfdc = new Map<string, Person>();
  for (const p of plan.people) { if (p.sfdcUserId) personBySfdc.set(p.sfdcUserId, p); if (p.sfdcContactId) personBySfdc.set(p.sfdcContactId, p); }
  const sfId = (p?: Person) => p?.sfdcUserId || p?.sfdcContactId || "";
  const ownersOf = (t: Task) => { const ids = [t.owner, ...(t.coworkers || [])].map(id => sfId(plan.people.find(p => p.id === id))); return ids.every(Boolean) && ids.length ? ids.join(",") : undefined; };

  // Adopt tasks that match a checkpoint by phase + title (the plan was started before it was linked).
  const byId = new Map(rows.map(r => [r.Id, r]));
  for (const row of rows) {
    if (plan.tasks.some(t => t.sfdcId === row.Id)) continue;
    const phase = phaseBySfdc.get(row.iseeit__Current_Phase__c || "");
    const twin = phase && plan.tasks.find(t => !t.sfdcId && !t.parent && t.phase === phase.id && lc(t.title) === lc(row.iseeit__Title__c || ""));
    if (twin) { twin.sfdcId = row.Id; twin.sfdcSeen = { ...seenOf(row), planOwners: ownersOf(twin) }; }
  }

  const fields: Array<keyof Seen> = ["title", "desc", "status", "due", "shared"];
  for (const task of plan.tasks) {
    if (task.parent || !task.sfdcId) continue;
    const row = byId.get(task.sfdcId);
    if (!row) { note(`“${task.title}” is no longer in Salesforce. It is kept here, but no longer linked`, task.id); out.skipped.push(`“${task.title}” is gone from Salesforce`); delete task.sfdcId; delete task.sfdcSeen; task.sfdcSkip = true; continue; }
    const sf = seenOf(row), base = task.sfdcSeen || sf;
    const mine: Seen = { title: task.title, desc: task.desc || "", status: task.status, due: dateOf(task.due), shared: task.shared !== false, owners: sf.owners };
    const push: Array<keyof Seen> = [];
    for (const f of fields) {
      const s = sf[f], b = base[f], m = mine[f];
      if (s === m) continue;
      if (f === "due" && s === null && m !== null) { push.push(f); continue; }
      if (s === b) { push.push(f); continue; }                    // only the plan changed
      if (m === b) {                                              // only Salesforce changed: pull
        if (f === "title") { if (!s) continue; task.title = s as string; } else if (f === "desc") task.desc = s as string;
        else if (f === "status") { task.status = s as string; task.closedAt = s === "Closed" ? today : null; }
        else if (f === "due") { if (!s) continue; task.due = s as string; } else task.shared = s as boolean;
        out.pulled.push(`“${mine.title}”: ${f}`); note(`${f === "status" ? (s === "Closed" ? "closed" : `set to ${s}:`) : `changed the ${f === "desc" ? "description" : f} of`} “${mine.title}” in Salesforce`, task.id);
        continue;
      }
      push.push(f);                                               // both changed, differently: the plan wins
      const was = f === "desc" ? "a different description" : `“${s ?? "empty"}”`;
      out.conflicts.push(`“${mine.title}”: ${f}`);
      note(`kept ${f === "desc" ? "its own description" : `${f} ${m === null ? "empty" : "“" + m + "”"}`} for “${mine.title}”; Salesforce had ${was} (overwritten)`, task.id);
    }
    // Owners: the plan changed → push (when everyone has a Salesforce id); only Salesforce changed → pull (when everyone is on the plan).
    const people = [task.owner, ...(task.coworkers || [])].map(id => plan.people.find(p => p.id === id));
    const ids = people.map(sfId);
    const myOwners = people.length && ids.every(Boolean) ? ids.join(",") : null;
    const planChanged = myOwners !== null && base.planOwners !== undefined && myOwners !== base.planOwners;
    const seenAfter: Seen = { ...sf, planOwners: myOwners ?? base.planOwners };
    const send: SfFields = fieldsFor(mine, push);
    for (const f of push) (seenAfter as Record<string, unknown>)[f] = mine[f];
    let pushOwners = false;
    if (planChanged && myOwners !== sf.owners) {
      pushOwners = true; seenAfter.owners = myOwners!;
      send.iseeit__Phase_Checkpoint_Owner__c = myOwners; send.iseeit__Checkpoint_Phase_Owner_Description__c = people.map(p => p?.name || "").join(" | ");
    } else if (!planChanged && sf.owners !== base.owners) {
      const found = ownerList(sf.owners).map(x => personBySfdc.get(x));
      if (found.length && found.every(Boolean)) {
        const next = found.map(p => p!.id);
        if (next[0] !== task.owner || next.slice(1).join() !== (task.coworkers || []).join()) { task.owner = next[0]; task.coworkers = next.slice(1); out.pulled.push(`“${mine.title}”: owners`); note(`changed the owners of “${mine.title}” in Salesforce`, task.id); }
        seenAfter.planOwners = found.map(p => sfId(p)).join(",");
      }
    }
    if (Object.keys(send).length) { out.updates.push({ taskId: task.id, sfdcId: task.sfdcId, fields: send, seen: seenAfter }); out.pushed.push(`“${mine.title}”: ${[...push, ...(pushOwners ? ["owners"] : [])].join(", ")}`); }
    else task.sfdcSeen = seenAfter;
  }

  // Checkpoints the plan lacks → new tasks (not N/A ones).
  const linked = new Set(plan.tasks.map(t => t.sfdcId).filter(Boolean));
  for (const row of rows) {
    if (linked.has(row.Id) || row.iseeit__Checkpoint_N_A__c) continue;
    const phase = phaseBySfdc.get(row.iseeit__Current_Phase__c || ""); if (!phase) continue;
    const sf = seenOf(row), found = ownerList(sf.owners).map(x => personBySfdc.get(x)).filter((p): p is Person => Boolean(p));
    const owner = found[0]?.id || plan.planOwners?.seller || plan.people[0]?.id || "";
    plan.seq = (plan.seq || 1000) + 1;
    const added: Task = { id: "t" + plan.seq, phase: phase.id, parent: null, title: sf.title || "Untitled", desc: sf.desc, owner, coworkers: found.slice(1).map(p => p.id), recipients: [], due: sf.due || phase.end || today, status: sf.status, shared: sf.shared, milestone: false, createdBy: owner, updates: [], sfdcId: row.Id, sfdcSeen: sf };
    added.sfdcSeen = { ...sf, planOwners: ownersOf(added) };
    let at = -1; plan.tasks.forEach((t, i) => { if (t.phase === phase.id) at = i; });
    plan.tasks.splice(at + 1, 0, added);
    out.pulled.push(`new “${added.title}”`); note(`added “${added.title}” from Salesforce`, added.id);
  }

  // Plan tasks Salesforce lacks → new checkpoints. On the first sync only when asked.
  for (const task of plan.tasks) {
    if (task.parent || task.sfdcId || task.sfdcSkip) continue;
    const phase = plan.phases.find(p => p.id === task.phase);
    if (!phase?.sfdcId) { out.skipped.push(`“${task.title}”: its phase isn't in Salesforce`); continue; }
    if (first && !opts.sendUnlinked) { out.unlinked++; continue; }
    const seen: Seen = { title: task.title, desc: task.desc || "", status: task.status, due: dateOf(task.due), shared: task.shared !== false, owners: "" };
    out.creates.push({ taskId: task.id, fields: { ...fieldsFor(seen), iseeit__Current_Phase__c: phase.sfdcId, iseeit__Is_From_Close_Plan__c: true }, seen });
    out.pushed.push(`new “${task.title}”`);
  }

  if (activity.length) plan.activity = [...activity.reverse(), ...(plan.activity || [])].slice(0, 40);
  return out;
}

// Records what reached Salesforce: sfdcSeen for updated tasks, the new Id for created ones. On the first sync,
// plan tasks that stayed here are marked so later syncs don't send them.
export function commit(outcome: SyncOutcome, opportunityId: string, written: { updated: Set<string>; created: Map<string, string> }, now = new Date()): SyncPlan {
  const plan = outcome.plan;
  for (const u of outcome.updates) if (written.updated.has(u.taskId)) { const t = plan.tasks.find(x => x.id === u.taskId); if (t) t.sfdcSeen = u.seen; }
  for (const c of outcome.creates) { const id = written.created.get(c.taskId), t = plan.tasks.find(x => x.id === c.taskId); if (id && t) { t.sfdcId = id; t.sfdcSeen = c.seen; } }
  if (!plan.sfdc?.syncedAt) for (const t of plan.tasks) if (!t.sfdcId && !t.parent) t.sfdcSkip = true;
  plan.sfdc = { ...plan.sfdc, opportunityId, syncedAt: now.toISOString() };
  return plan;
}

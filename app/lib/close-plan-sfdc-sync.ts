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
  iseeit__Phase_Checkpoint_Owner__c?: string | null; iseeit__Checklist_Description__c?: string | null; iseeit__Checkpoint_N_A__c?: boolean | null; iseeit__Close_Plan_Order__c?: string | number | null;
};

type Person = { id: string; name?: string; email?: string; contactIds?: string[]; sfdcUserId?: string; sfdcContactId?: string; title?: string; side?: string; role?: string; access?: object; invite?: object };
export type PhaseSeen = { title: string; start: string | null; end: string | null };
type Phase = { id: string; name?: string; goal?: string; start?: string; end?: string; sfdcId?: string; sfdcSeen?: PhaseSeen; sfdcRank?: number };
export type Seen = { title: string; desc: string; status: string; due: string | null; shared: boolean; owners: string; planOwners?: string };
type Task = { id: string; phase: string; parent: string | null; title: string; desc?: string; owner: string; coworkers?: string[]; due?: string; status: string; shared: boolean; sfdcId?: string; sfdcSeen?: Seen; sfdcRank?: number; sfdcSkip?: boolean; [k: string]: unknown };
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
export type Update = { taskId: string; sfdcId: string; fields: SfFields; seen: Seen; rank?: number };
export type Create = { taskId: string; fields: SfFields; seen: Seen };
export type PhaseUpdate = { phaseId: string; sfdcId: string; fields: SfFields; seen: PhaseSeen; rank?: number };
export type SyncOutcome = {
  plan: SyncPlan;                 // pulls applied; pushes not yet recorded in sfdcSeen (see commit)
  updates: Update[]; creates: Create[]; phaseUpdates: PhaseUpdate[];
  pulled: string[]; pushed: string[]; conflicts: string[]; skipped: string[];
  unlinked: number;               // plan tasks that exist only here, held back on the first sync
};

export const checkpointQuery = (opportunityId: string) => {
  if (!isSalesforceId(opportunityId)) throw new Error("Invalid Salesforce opportunity id");
  return "SELECT Id, iseeit__Title__c, iseeit__Current_Phase__c, iseeit__Phase_Checkpoint_Status__c, iseeit__Status__c, iseeit__Deadline__c, " +
    "iseeit__Interaction_Type__c, iseeit__Phase_Checkpoint_Owner__c, iseeit__Checklist_Description__c, iseeit__Checkpoint_N_A__c, iseeit__Close_Plan_Order__c " +
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

// Order is compared as ranks, not values: Salesforce numbers can have gaps, the plan's order is its array order.
const num = (v: unknown) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n; };
const ranksOf = (values: Array<number | null>) => { const idx = values.map((_, i) => i).sort((a, b) => (values[a] ?? Infinity) - (values[b] ?? Infinity) || a - b); const r: number[] = []; idx.forEach((i, rank) => { r[i] = rank; }); return r; };
export const MAX_TASK_ORDER = 26, MAX_PHASE_ORDER = 27;

// Puts a phase's linked top-level tasks (each with its subtasks) into the given order, in the slots those tasks occupy now.
function reorderPhaseTasks(plan: SyncPlan, phaseId: string, orderedIds: string[]) {
  const tops = plan.tasks.filter(t => t.phase === phaseId && !t.parent);
  const blocks = tops.map(t => [t, ...plan.tasks.filter(x => x.parent === t.id)]);
  const slots = blocks.map((b, i) => orderedIds.includes(b[0].id) ? i : -1).filter(i => i >= 0);
  const sorted = [...slots].map(i => blocks[i]).sort((a, b) => orderedIds.indexOf(a[0].id) - orderedIds.indexOf(b[0].id));
  slots.forEach((slot, k) => { blocks[slot] = sorted[k]; });
  const first = plan.tasks.findIndex(t => t.phase === phaseId && !t.parent);
  const moved = new Set(blocks.flat().map(t => t.id));
  plan.tasks = plan.tasks.filter(t => !moved.has(t.id));
  plan.tasks.splice(first, 0, ...blocks.flat());
}

export function syncPlan(input: SyncPlan, phaseRows: SfPhaseRow[], rows: SfCheckpointRow[], opts: { sendUnlinked?: boolean; today?: string } = {}): SyncOutcome {
  const plan: SyncPlan = structuredClone(input);
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const first = !plan.sfdc?.syncedAt;
  const out: SyncOutcome = { plan, updates: [], creates: [], phaseUpdates: [], pulled: [], pushed: [], conflicts: [], skipped: [], unlinked: 0 };
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
  // Phase name and dates: same three-way rule as the tasks (only Salesforce changed → pull, only the plan → push, both → the plan wins).
  for (const row of phaseRows) {
    const phase = phaseBySfdc.get(row.Id); if (!phase) continue;
    const sf: PhaseSeen = { title: (row.iseeit__Title__c || "").trim(), start: row.iseeit__Start_Date__c || null, end: row.iseeit__End_Date__c || null };
    const base = phase.sfdcSeen || sf, mine: PhaseSeen = { title: phase.name || "", start: phase.start || null, end: phase.end || null };
    const send: SfFields = {}, seenAfter: PhaseSeen = { ...sf }, label = phase.name || sf.title;
    for (const f of ["title", "start", "end"] as const) {
      const s_ = sf[f], b = base[f], m = mine[f];
      if (s_ === m) continue;
      const pushIt = () => { send[f === "title" ? "iseeit__Title__c" : f === "start" ? "iseeit__Start_Date__c" : "iseeit__End_Date__c"] = m; (seenAfter as Record<string, string | null>)[f] = m; };
      if (f !== "title" && s_ === null) { if (m !== null) pushIt(); continue; }
      if (s_ === b) { if (m) pushIt(); continue; }
      if (m === b || !m) {
        if (!s_) continue;
        if (f === "title") phase.name = s_; else phase[f] = s_;
        out.pulled.push(`phase “${label}”: ${f === "title" ? "name" : f === "start" ? "start date" : "end date"}`);
        note(`changed the ${f === "title" ? "name" : f === "start" ? "start date" : "end date"} of the phase “${label}” in Salesforce`, null);
        continue;
      }
      pushIt(); out.conflicts.push(`phase “${label}”: ${f}`);
      note(`kept ${f === "title" ? "the name" : f === "start" ? "the start date" : "the end date"} “${m}” for the phase “${label}”; Salesforce had “${s_}” (overwritten)`, null);
    }
    if (Object.keys(send).length) { out.phaseUpdates.push({ phaseId: phase.id, sfdcId: row.Id, fields: send, seen: seenAfter }); out.pushed.push(`phase “${label}”: ${Object.keys(send).map(k => k.replace("iseeit__", "").replace("_Date__c", " date").replace("__c", "").toLowerCase()).join(", ")}`); }
    else phase.sfdcSeen = seenAfter;
  }
  // Phase order.
  {
    const rowById = new Map(phaseRows.map(r => [r.Id, r]));
    const linked = plan.phases.filter(p => p.sfdcId && rowById.has(p.sfdcId));
    if (linked.length > 1) {
      const mineRank = linked.map((_, i) => i), sfRank = ranksOf(linked.map(p => num(rowById.get(p.sfdcId as string)!.iseeit__Phase_Order__c)));
      const base = linked.map((p, i) => p.sfdcRank ?? sfRank[i]);
      const planMoved = linked.some((_, i) => mineRank[i] !== base[i]), sfMoved = linked.some((_, i) => sfRank[i] !== base[i]);
      if (planMoved) {
        linked.forEach((p, i) => {
          if (mineRank[i] === sfRank[i]) { p.sfdcRank = mineRank[i]; return; }
          const value = String(Math.min(plan.phases.indexOf(p) + 1, MAX_PHASE_ORDER));
          const existing = out.phaseUpdates.find(u => u.phaseId === p.id);
          if (existing) { existing.fields.iseeit__Phase_Order__c = value; existing.rank = mineRank[i]; }
          else out.phaseUpdates.push({ phaseId: p.id, sfdcId: p.sfdcId as string, fields: { iseeit__Phase_Order__c: value }, seen: p.sfdcSeen || { title: p.name || "", start: p.start || null, end: p.end || null }, rank: mineRank[i] });
        });
        out.pushed.push("phase order");
        if (sfMoved) { out.conflicts.push("phase order"); note("kept its own phase order; Salesforce had a different order (overwritten)", null); }
      } else if (sfMoved) {
        const slots = linked.map(p => plan.phases.indexOf(p)), sorted = linked.map((p, i) => ({ p, r: sfRank[i] })).sort((a, b) => a.r - b.r).map(x => x.p);
        slots.forEach((slot, k) => { plan.phases[slot] = sorted[k]; });
        sorted.forEach((p, k) => { p.sfdcRank = k; });
        out.pulled.push("phase order"); note("changed the order of the phases in Salesforce", null);
      } else linked.forEach((p, i) => { p.sfdcRank = sfRank[i]; });
    }
  }
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

  // Task order within each phase.
  for (const phase of plan.phases) {
    const linked = plan.tasks.filter(t => t.phase === phase.id && !t.parent && t.sfdcId && byId.has(t.sfdcId));
    if (linked.length < 2) { linked.forEach(t => { t.sfdcRank = 0; }); continue; }
    const mineRank = linked.map((_, i) => i), sfRank = ranksOf(linked.map(t => num(byId.get(t.sfdcId as string)!.iseeit__Close_Plan_Order__c)));
    const base = linked.map((t, i) => t.sfdcRank ?? sfRank[i]);
    const planMoved = linked.some((_, i) => mineRank[i] !== base[i]), sfMoved = linked.some((_, i) => sfRank[i] !== base[i]);
    if (planMoved) {
      linked.forEach((t, i) => {
        if (mineRank[i] === sfRank[i]) { t.sfdcRank = mineRank[i]; return; }
        const existing = out.updates.find(u => u.taskId === t.id), value = String(Math.min(i, MAX_TASK_ORDER));
        if (existing) { existing.fields.iseeit__Close_Plan_Order__c = value; existing.rank = mineRank[i]; }
        else out.updates.push({ taskId: t.id, sfdcId: t.sfdcId as string, fields: { iseeit__Close_Plan_Order__c: value }, seen: t.sfdcSeen || seenOf(byId.get(t.sfdcId as string)!), rank: mineRank[i] });
      });
      out.pushed.push(`order of the tasks in “${phase.name || phase.id}”`);
      if (sfMoved) { out.conflicts.push(`order in “${phase.name || phase.id}”`); note(`kept its own task order in “${phase.name || phase.id}”; Salesforce had a different order (overwritten)`, null); }
    } else if (sfMoved) {
      const sorted = linked.map((t, i) => ({ t, r: sfRank[i] })).sort((a, b) => a.r - b.r).map(x => x.t);
      reorderPhaseTasks(plan, phase.id, sorted.map(t => t.id));
      sorted.forEach((t, k) => { t.sfdcRank = k; });
      out.pulled.push(`order of the tasks in “${phase.name || phase.id}”`); note(`changed the task order in “${phase.name || phase.id}” in Salesforce`, null);
    } else linked.forEach((t, i) => { t.sfdcRank = sfRank[i]; });
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
    const owners = ownersOf(task), seen: Seen = { title: task.title, desc: task.desc || "", status: task.status, due: dateOf(task.due), shared: task.shared !== false, owners: owners || "", planOwners: owners };
    const ownerFields: SfFields = owners ? { iseeit__Phase_Checkpoint_Owner__c: owners, iseeit__Checkpoint_Phase_Owner_Description__c: [task.owner, ...(task.coworkers || [])].map(id => plan.people.find(p => p.id === id)?.name || "").join(" | ") } : {};
    out.creates.push({ taskId: task.id, fields: { ...fieldsFor(seen), ...ownerFields, iseeit__Current_Phase__c: phase.sfdcId, iseeit__Is_From_Close_Plan__c: true, iseeit__Close_Plan_Order__c: String(Math.min(plan.tasks.filter(t => t.phase === task.phase && !t.parent).indexOf(task), MAX_TASK_ORDER)) }, seen });
    out.pushed.push(`new “${task.title}”`);
  }

  if (activity.length) plan.activity = [...activity.reverse(), ...(plan.activity || [])].slice(0, 40);
  return out;
}

// Records what reached Salesforce: sfdcSeen for updated tasks, the new Id for created ones. On the first sync,
// plan tasks that stayed here are marked so later syncs don't send them.
export function commit(outcome: SyncOutcome, opportunityId: string, written: { updated: Set<string>; created: Map<string, string> }, now = new Date()): SyncPlan {
  const plan = outcome.plan;
  for (const u of outcome.updates) if (written.updated.has(u.taskId)) { const t = plan.tasks.find(x => x.id === u.taskId); if (t) { t.sfdcSeen = u.seen; if (u.rank !== undefined) t.sfdcRank = u.rank; } }
  for (const u of outcome.phaseUpdates) if (written.updated.has(u.phaseId)) { const ph = plan.phases.find(x => x.id === u.phaseId); if (ph) { ph.sfdcSeen = u.seen; if (u.rank !== undefined) ph.sfdcRank = u.rank; } }
  for (const c of outcome.creates) { const id = written.created.get(c.taskId), t = plan.tasks.find(x => x.id === c.taskId); if (id && t) { t.sfdcId = id; t.sfdcSeen = c.seen; } }
  if (!plan.sfdc?.syncedAt) for (const t of plan.tasks) if (!t.sfdcId && !t.parent) t.sfdcSkip = true;
  plan.sfdc = { ...plan.sfdc, opportunityId, syncedAt: now.toISOString() };
  return plan;
}

// People on a plan carry Salesforce ids only once they are looked up: iSEEit people by email in User, customer contacts
// by email in Contact. Without an id a person can't be written as a checkpoint owner.
const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const emailOf = (p: Person) => (p.email || "").trim().toLowerCase();
export function idLookupQueries(people: Person[]): { users: string | null; contacts: string | null } {
  // A contact added from Sales AI carries its ids; one of them is usually the Salesforce contact id.
  for (const p of people) if (p.side === "buyer" && !p.sfdcContactId) { const sf = (p.contactIds || []).find(id => /^003[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(id)); if (sf) p.sfdcContactId = sf; }
  const need = (side: string) => [...new Set(people.filter(p => p.side === side && !p.sfdcUserId && !p.sfdcContactId && /^[^\s@']+@[^\s@']+$/.test(emailOf(p))).map(emailOf))].slice(0, 50);
  const list = (emails: string[]) => emails.map(soqlString).join(",");
  const sellers = need("seller"), buyers = need("buyer");
  return {
    users: sellers.length ? `SELECT Id, Email FROM User WHERE IsActive = true AND Email IN (${list(sellers)})` : null,
    contacts: buyers.length ? `SELECT Id, Email FROM Contact WHERE Email IN (${list(buyers)})` : null,
  };
}
export function applySalesforceIds(plan: SyncPlan, users: Array<{ Id: string; Email?: string | null }>, contacts: Array<{ Id: string; Email?: string | null }>): void {
  const first = (rows: Array<{ Id: string; Email?: string | null }>) => { const m = new Map<string, string>(); for (const r of rows) { const e = (r.Email || "").toLowerCase(); if (e && !m.has(e)) m.set(e, r.Id); } return m; };
  const byUser = first(users), byContact = first(contacts);
  for (const p of plan.people) {
    if (p.sfdcUserId || p.sfdcContactId) continue;
    const e = emailOf(p);
    if (p.side === "seller" && byUser.has(e)) p.sfdcUserId = byUser.get(e);
    else if (p.side === "buyer" && byContact.has(e)) p.sfdcContactId = byContact.get(e);
  }
}

// Owners that exist in Salesforce but not on the plan (a customer contact or colleague added to a checkpoint there) are
// looked up by id and added to the plan as people, so they show up as owner or coworker. Salesforce users become iSEEit
// people, contacts become customer people (no invitation).
export function unknownOwnerIds(plan: SyncPlan, rows: SfCheckpointRow[]): { users: string[]; contacts: string[] } {
  const known = new Set(plan.people.flatMap(p => [p.sfdcUserId, p.sfdcContactId].filter(Boolean) as string[]));
  const ids = [...new Set(rows.filter(r => !r.iseeit__Checkpoint_N_A__c).flatMap(r => ownerList(r.iseeit__Phase_Checkpoint_Owner__c)))].filter(id => /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(id) && !known.has(id));
  return { users: ids.filter(id => id.startsWith("005")).slice(0, 50), contacts: ids.filter(id => id.startsWith("003")).slice(0, 50) };
}
export function ownerLookupQueries(ids: { users: string[]; contacts: string[] }): { users: string | null; contacts: string | null } {
  const list = (a: string[]) => a.map(x => `'${x}'`).join(",");
  return {
    users: ids.users.length ? `SELECT Id, Name, Email FROM User WHERE Id IN (${list(ids.users)})` : null,
    contacts: ids.contacts.length ? `SELECT Id, Name, Email, Title FROM Contact WHERE Id IN (${list(ids.contacts)})` : null,
  };
}
export function addOwnerPeople(plan: SyncPlan, users: Array<{ Id: string; Name?: string | null; Email?: string | null }>, contacts: Array<{ Id: string; Name?: string | null; Email?: string | null; Title?: string | null }>): number {
  let added = 0;
  const exists = (email?: string | null) => Boolean(email) && plan.people.some(p => (p.email || "").toLowerCase() === (email || "").toLowerCase());
  for (const u of users) {
    const known = plan.people.find(p => (p.email || "").toLowerCase() === (u.Email || "").toLowerCase() && u.Email);
    if (known) { known.sfdcUserId = known.sfdcUserId || u.Id; continue; }
    plan.people.push({ id: "sf" + u.Id.slice(-8), name: u.Name || "Salesforce user", email: u.Email || "", title: "Salesforce user", side: "seller", role: "", sfdcUserId: u.Id, access: { level: "all", create: true, manage: false }, invite: { status: "member" } }); added++;
  }
  for (const c of contacts) {
    const known = plan.people.find(p => (p.email || "").toLowerCase() === (c.Email || "").toLowerCase() && c.Email);
    if (known) { known.sfdcContactId = known.sfdcContactId || c.Id; continue; }
    if (exists(c.Email)) continue;
    plan.people.push({ id: "sf" + c.Id.slice(-8), name: c.Name || "Contact", email: c.Email || "", title: c.Title || "", side: "buyer", role: "", sfdcContactId: c.Id, access: { level: "own", create: true, manage: false }, invite: { status: "none" } }); added++;
  }
  return added;
}

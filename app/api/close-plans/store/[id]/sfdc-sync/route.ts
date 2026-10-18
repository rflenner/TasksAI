import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { applySalesforceIds, checkpointQuery, commit, idLookupQueries, phaseQuery, syncPlan, type SfCheckpointRow, type SfPhaseRow, type SyncPlan } from "../../../../../lib/close-plan-sfdc-sync";
import { isOpportunityId } from "../../../../../lib/salesforce-opportunity-search";
import { canAccessPlan, canDeletePlan, memberEmails } from "../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../lib/request";
import { SalesforceNotConnectedError, salesforceApi } from "../../../../../lib/salesforce";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

type WriteResult = Array<{ id: string | null; success: boolean; errors?: Array<{ message: string }> }>;
const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;
const chunks = <T,>(list: T[], n = 200) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const sobjects = (records: Array<Record<string, unknown>>) => records.map(r => ({ attributes: { type: "iseeit__TO_DO__c" }, ...r }));

// Link this plan to its Salesforce opportunity and sync both ways.
// { mode: "preview" } computes the changes without touching anything;
// { mode: "apply", sendUnlinked? } writes them to Salesforce and saves the plan.
// Close Plan wins when both sides changed the same field. Owners of the plan and admins only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { mode?: string; opportunityId?: string; sendUnlinked?: boolean };
  const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
  if (!row || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });
  const data = row.data as SyncPlan & { sfdcOpportunityId?: string };
  if (!canDeletePlan(actor, data)) return Response.json({ error: "Only the plan owner and admins can sync with Salesforce" }, { status: 403 });
  const opportunityId = [body.opportunityId, data.sfdc?.opportunityId, data.sfdcOpportunityId].find((v): v is string => typeof v === "string" && isOpportunityId(v));
  if (!opportunityId) return Response.json({ error: "This plan is not linked to a Salesforce opportunity" }, { status: 400 });

  let phases: SfPhaseRow[], rows: SfCheckpointRow[];
  try { [phases, rows] = await Promise.all([query<SfPhaseRow>(phaseQuery(opportunityId)), query<SfCheckpointRow>(checkpointQuery(opportunityId))]); }
  catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: "Salesforce is not connected. Connect it under Integrations." }, { status: 409 });
    return Response.json({ error: "Salesforce could not be reached" }, { status: 502 });
  }
  if (!phases.length) return Response.json({ error: "That opportunity has no close plan in Salesforce yet" }, { status: 404 });

  // Look up Salesforce ids for the people on the plan (by email), so owners can be written.
  const lookups = idLookupQueries(data.people);
  try { applySalesforceIds(data, lookups.users ? await query<{ Id: string; Email: string }>(lookups.users) : [], lookups.contacts ? await query<{ Id: string; Email: string }>(lookups.contacts) : []); }
  catch (error) { console.error("Close Plan owner id lookup failed:", error instanceof Error ? error.message : error); }
  const outcome = syncPlan(data, phases, rows, { sendUnlinked: body.sendUnlinked === true });
  const summary = { opportunityId, pulled: outcome.pulled, pushed: outcome.pushed, conflicts: outcome.conflicts, skipped: outcome.skipped, unlinked: outcome.unlinked };
  if (body.mode !== "apply") return Response.json({ applied: false, ...summary });

  const updated = new Set<string>(), created = new Map<string, string>(), failed: string[] = [];
  try {
    for (const part of chunks(outcome.phaseUpdates)) {
      const results = await salesforceApi<WriteResult>("/composite/sobjects", { method: "PATCH", body: { allOrNone: false, records: part.map(u => ({ attributes: { type: "iseeit__Current_Phase__c" }, id: u.sfdcId, ...u.fields })) } });
      part.forEach((u, i) => { if (results[i]?.success) updated.add(u.phaseId); else failed.push(results[i]?.errors?.map(e => e.message).join("; ") || "Salesforce rejected a phase change"); });
    }
    for (const part of chunks(outcome.updates)) {
      const results = await salesforceApi<WriteResult>("/composite/sobjects", { method: "PATCH", body: { allOrNone: false, records: sobjects(part.map(u => ({ id: u.sfdcId, ...u.fields }))) } });
      part.forEach((u, i) => { if (results[i]?.success) updated.add(u.taskId); else failed.push(results[i]?.errors?.map(e => e.message).join("; ") || "Salesforce rejected an update"); });
    }
    for (const part of chunks(outcome.creates)) {
      const results = await salesforceApi<WriteResult>("/composite/sobjects", { method: "POST", body: { allOrNone: false, records: sobjects(part.map(c => ({ iseeit__Opportunity__c: opportunityId, ...c.fields }))) } });
      part.forEach((c, i) => { const r = results[i]; if (r?.success && r.id) created.set(c.taskId, r.id); else failed.push(r?.errors?.map(e => e.message).join("; ") || "Salesforce rejected a new task"); });
    }
  } catch (error) {
    // Some writes may already have gone through; save what is known so the next sync doesn't repeat them.
    console.error("Close Plan Salesforce write failed:", error instanceof Error ? error.message : error);
    failed.push("Salesforce stopped answering part-way");
  }
  const first = !data.sfdc?.syncedAt;
  const next = commit(outcome, opportunityId, { updated, created });
  // An automatic sync that changed nothing must not bump the version (it would make every open page's next save conflict).
  const stable = (d: SyncPlan) => JSON.stringify({ ...d, sfdc: { ...d.sfdc, syncedAt: null } });
  if (!first && !failed.length && stable(next) === stable(data)) return Response.json({ applied: true, unchanged: true, ...summary, written: { updated: 0, created: 0 }, failed });
  const [saved] = await getDb().update(closePlanDocuments)
    .set({ data: next, memberEmails: memberEmails(next), version: row.version + 1, updatedBy: actor.id, updatedAt: new Date() })
    .where(and(eq(closePlanDocuments.id, id), eq(closePlanDocuments.version, row.version), isNull(closePlanDocuments.deletedAt))).returning();
  if (!saved) return Response.json({ error: "Someone changed the plan while it was syncing. Run the sync again.", ...summary }, { status: 409 });
  return Response.json({ applied: true, ...summary, written: { updated: updated.size, created: created.size }, failed, plan: { id, version: saved.version, updatedAt: saved.updatedAt.toISOString(), data: saved.data } });
}

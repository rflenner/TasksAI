import { and, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { closePlanDocuments } from "../../../../../db/schema";
import { checkpointQuery, commit, phaseQuery, syncPlan, type SfCheckpointRow, type SfPhaseRow, type SyncPlan } from "../../../../lib/close-plan-sfdc-sync";
import { canCreatePlan, memberEmails } from "../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../lib/request";
import { SalesforceNotConnectedError, salesforceApi } from "../../../../lib/salesforce";
import { isOpportunityId } from "../../../../lib/salesforce-opportunity-search";
import { currentActor } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;

// Creates a Close Plan from an opportunity's close plan in Salesforce: its phases and checkpoints become the
// plan's phases and tasks, and the plan stays linked and syncs both ways from then on (docs/close-plan-salesforce.md).
// Reads Salesforce only. A plan already linked to the opportunity is returned instead of creating a second one.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!canCreatePlan(actor)) return Response.json({ error: "Only admins can create close plans" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { opportunityId?: string };
  const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId.trim() : "";
  if (!isOpportunityId(opportunityId)) return Response.json({ error: "Not a Salesforce opportunity id" }, { status: 400 });

  const [existing] = await getDb().select({ id: closePlanDocuments.id }).from(closePlanDocuments)
    .where(and(isNull(closePlanDocuments.deletedAt), or(sql`${closePlanDocuments.data}->'sfdc'->>'opportunityId' = ${opportunityId}`, sql`${closePlanDocuments.data}->>'sfdcOpportunityId' = ${opportunityId}`))).limit(1);
  if (existing) return Response.json({ id: existing.id, existing: true });

  let opp: { Name: string | null; Account?: { Name?: string | null } | null } | undefined, phases: SfPhaseRow[], rows: SfCheckpointRow[];
  try {
    [[opp], phases, rows] = await Promise.all([
      query<NonNullable<typeof opp>>(`SELECT Name, Account.Name FROM Opportunity WHERE Id = '${opportunityId}'`),
      query<SfPhaseRow>(phaseQuery(opportunityId)), query<SfCheckpointRow>(checkpointQuery(opportunityId)),
    ]);
  } catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: "Salesforce is not connected. Connect it under Integrations." }, { status: 409 });
    return Response.json({ error: "Salesforce could not be reached" }, { status: 502 });
  }
  if (!opp) return Response.json({ error: "Opportunity not found in Salesforce" }, { status: 404 });
  if (!phases.length) return Response.json({ error: "That opportunity has no close plan in Salesforce yet" }, { status: 404 });

  const me = "u" + actor.id, account = opp.Account?.Name || opp.Name || "Salesforce opportunity";
  const skeleton: SyncPlan & Record<string, unknown> = {
    id: "pl" + Date.now(), account, domain: "", status: "draft", title: `${account} close plan`, accountId: null, sfdcOpportunityId: opportunityId,
    opp: { name: opp.Name || "", stage: "", amount: null }, phases: [], tasks: [],
    people: [{ id: me, name: actor.name, email: actor.email, title: "Task AI user", side: "seller", role: "Account lead", access: { level: "all", create: true, manage: false }, invite: { status: "member" } }],
    planOwners: { seller: me, buyer: null }, activity: [], seq: 1000, setup: { dates: false, internal: false, hidden: false },
  };
  const outcome = syncPlan(skeleton, phases, rows);
  const plan = commit(outcome, opportunityId, { updated: new Set(), created: new Map() });
  const [saved] = await getDb().insert(closePlanDocuments).values({ id: String(plan.id), title: String(plan.title), account, data: plan, memberEmails: memberEmails(plan), version: 1, createdBy: actor.id, updatedBy: actor.id }).returning();
  return Response.json({ id: saved.id, phases: plan.phases.length, tasks: plan.tasks.length }, { status: 201 });
}

import { salesforceApi } from "./salesforce";

// Close-plan checkpoints of one Salesforce opportunity, for /playground.
// The query is the iSEEit managed package's own close-plan shape (phases
// iseeit__Current_Phase__c, each with its checkpoints — iseeit__TO_DO__c
// rows — through iseeit__iSEEit_current_Checkpoints__r), plus
// iseeit__Checklist_Description__c, the field Sales AI's CRM Update
// Center writes a checkpoint's description to.

// A Salesforce record id: 15 or 18 alphanumerics. Checked before an id is
// placed into SOQL, which has no bind parameters over REST.
export function isSalesforceId(value: string) { return /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value); }

export const MAX_DESCRIPTION_LENGTH = 32768; // Long Text Area ceiling

export type Checkpoint = { id: string; title: string; status: boolean; phaseCheckpointStatus: string | null; deadline: string | null; owner: string | null; order: number | null; required: string | null; description: string };
export type Phase = { id: string; title: string; order: number | null; startDate: string | null; endDate: string | null; checkpoints: Checkpoint[] };
export type OpportunityCheckpoints = { opportunity: { id: string; name: string }; phases: Phase[] };

type SfCheckpoint = { Id: string; iseeit__Title__c: string | null; iseeit__Status__c: boolean | null; iseeit__Phase_Checkpoint_Status__c: string | null; iseeit__Deadline__c: string | null; iseeit__Phase_Checkpoint_Owner__c: string | null; iseeit__Close_Plan_Order__c: number | null; iseeit__Checklist_Description__c: string | null; iseeit__Default_Checklists__r: { iseeit__Required_Or_Optional_Checkpoint__c: string | null } | null };
type SfPhase = { Id: string; iseeit__Title__c: string | null; iseeit__Phase_Order__c: number | null; iseeit__Start_Date__c: string | null; iseeit__End_Date__c: string | null; iseeit__iSEEit_current_Checkpoints__r: { records: SfCheckpoint[] } | null };

export function closePlanSoql(opportunityId: string) {
  if (!isSalesforceId(opportunityId)) throw new Error("Invalid Salesforce opportunity id");
  return [
    "SELECT Id, iseeit__Title__c, iseeit__Phase_Order__c, iseeit__Start_Date__c, iseeit__End_Date__c,",
    "(SELECT Id, iseeit__Title__c, iseeit__Status__c, iseeit__Phase_Checkpoint_Status__c,",
    "iseeit__Deadline__c, iseeit__Phase_Checkpoint_Owner__c, iseeit__Close_Plan_Order__c,",
    "iseeit__Checklist_Description__c, iseeit__Default_Checklists__c,",
    "iseeit__Default_Checklists__r.iseeit__Required_Or_Optional_Checkpoint__c",
    "FROM iseeit__iSEEit_current_Checkpoints__r",
    "WHERE iseeit__Is_From_Close_Plan__c = true",
    "ORDER BY iseeit__Close_Plan_Order__c ASC)",
    "FROM iseeit__Current_Phase__c",
    `WHERE iseeit__Opportunity__c = '${opportunityId}'`,
    "ORDER BY iseeit__Phase_Order__c ASC",
  ].join(" ");
}

export function mapPhases(records: SfPhase[]): Phase[] {
  return records.map(phase => ({
    id: phase.Id,
    title: phase.iseeit__Title__c || "Untitled phase",
    order: phase.iseeit__Phase_Order__c,
    startDate: phase.iseeit__Start_Date__c,
    endDate: phase.iseeit__End_Date__c,
    checkpoints: (phase.iseeit__iSEEit_current_Checkpoints__r?.records || []).map(checkpoint => ({
      id: checkpoint.Id,
      title: checkpoint.iseeit__Title__c || "Untitled checkpoint",
      status: Boolean(checkpoint.iseeit__Status__c),
      phaseCheckpointStatus: checkpoint.iseeit__Phase_Checkpoint_Status__c,
      deadline: checkpoint.iseeit__Deadline__c,
      owner: checkpoint.iseeit__Phase_Checkpoint_Owner__c,
      order: checkpoint.iseeit__Close_Plan_Order__c,
      required: checkpoint.iseeit__Default_Checklists__r?.iseeit__Required_Or_Optional_Checkpoint__c ?? null,
      description: checkpoint.iseeit__Checklist_Description__c || "",
    })),
  }));
}

export async function fetchOpportunityCheckpoints(opportunityId: string): Promise<OpportunityCheckpoints | null> {
  if (!isSalesforceId(opportunityId)) throw new Error("Invalid Salesforce opportunity id");
  const opportunity = await salesforceApi<{ records: Array<{ Id: string; Name: string }> }>(`/query?q=${encodeURIComponent(`SELECT Id, Name FROM Opportunity WHERE Id = '${opportunityId}'`)}`);
  if (!opportunity.records.length) return null;
  const phases = await salesforceApi<{ records: SfPhase[] }>(`/query?q=${encodeURIComponent(closePlanSoql(opportunityId))}`);
  return { opportunity: { id: opportunity.records[0].Id, name: opportunity.records[0].Name }, phases: mapPhases(phases.records) };
}

export type DescriptionUpdate = { id: string; description: string };
export type DescriptionResult = { id: string; success: boolean; error?: string };

// Writes iseeit__Checklist_Description__c on the given checkpoints. Each id
// must be one of this opportunity's close-plan checkpoints as Salesforce
// reports them right now: the browser only ever sends back ids it was
// shown, but that's checked here rather than trusted, so this route can't
// be pointed at arbitrary TO_DO rows. One sObject Collections PATCH
// (allOrNone: false), so one bad row doesn't block the rest.
export async function updateCheckpointDescriptions(opportunityId: string, updates: DescriptionUpdate[]): Promise<DescriptionResult[]> {
  const current = await fetchOpportunityCheckpoints(opportunityId);
  if (!current) throw new Error("Opportunity not found in Salesforce");
  const known = new Set(current.phases.flatMap(phase => phase.checkpoints.map(checkpoint => checkpoint.id)));
  const unknown = updates.filter(update => !known.has(update.id));
  if (unknown.length) throw new Error("Some checkpoints don't belong to this opportunity's close plan — fetch it again");

  const results = await salesforceApi<Array<{ id: string | null; success: boolean; errors: Array<{ message: string }> }>>("/composite/sobjects", {
    method: "PATCH",
    body: { allOrNone: false, records: updates.map(update => ({ attributes: { type: "iseeit__TO_DO__c" }, id: update.id, iseeit__Checklist_Description__c: update.description })) },
  });
  // Results come back in request order; `id` is null on a failed row.
  return updates.map((update, index) => {
    const result = results[index];
    return result?.success ? { id: update.id, success: true } : { id: update.id, success: false, error: result?.errors?.map(error => error.message).join("; ") || "Salesforce rejected this update" };
  });
}

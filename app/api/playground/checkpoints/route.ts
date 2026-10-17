import { requireSameOrigin } from "../../../lib/request";
import { SalesforceNotConnectedError } from "../../../lib/salesforce";
import { MAX_DESCRIPTION_LENGTH, fetchOpportunityCheckpoints, isSalesforceId, updateCheckpointDescriptions, type DescriptionUpdate } from "../../../lib/salesforce-checkpoints";
import { currentActor } from "../../../lib/session";

// /playground's form: GET fetches one Salesforce opportunity's close-plan
// checkpoints, POST sends edited checkpoint descriptions back to
// Salesforce. Site Admin only — it reads and writes the workspace's
// Salesforce org with the connection from /integrations, not the
// visitor's own Salesforce access.
const MAX_UPDATES = 200; // sObject Collections limit per request

async function requireSiteAdmin() {
  const actor = await currentActor();
  return actor?.role === "site_admin" ? actor : null;
}
function isDescriptionUpdate(item: unknown): item is DescriptionUpdate {
  const candidate = item as Partial<DescriptionUpdate> | null;
  return typeof candidate?.id === "string" && isSalesforceId(candidate.id) && typeof candidate.description === "string";
}
const forbidden = () => Response.json({ error: "Site Admin access required" }, { status: 403 });

function failure(error: unknown) {
  if (error instanceof SalesforceNotConnectedError) return Response.json({ error: error.message }, { status: 409 });
  console.error("Playground Salesforce call failed:", error instanceof Error ? error.message : error);
  return Response.json({ error: error instanceof Error ? error.message : "Salesforce request failed" }, { status: 502 });
}

export async function GET(request: Request) {
  if (!await requireSiteAdmin()) return forbidden();
  const opportunityId = new URL(request.url).searchParams.get("opportunityId")?.trim() || "";
  if (!isSalesforceId(opportunityId)) return Response.json({ error: "Enter a valid Salesforce opportunity id (15 or 18 characters)" }, { status: 400 });
  try {
    const result = await fetchOpportunityCheckpoints(opportunityId);
    if (!result) return Response.json({ error: "No opportunity with that id in the connected Salesforce org" }, { status: 404 });
    return Response.json(result);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await requireSiteAdmin()) return forbidden();
  const body = await request.json().catch(() => ({})) as { opportunityId?: unknown; updates?: unknown };
  const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId.trim() : "";
  if (!isSalesforceId(opportunityId)) return Response.json({ error: "Enter a valid Salesforce opportunity id (15 or 18 characters)" }, { status: 400 });

  const raw: unknown[] = Array.isArray(body.updates) ? body.updates : [];
  if (!raw.length) return Response.json({ error: "Nothing to send — edit a checkpoint description first" }, { status: 400 });
  if (!raw.every(isDescriptionUpdate)) return Response.json({ error: "Each update needs a checkpoint id and a description" }, { status: 400 });
  const updates = raw as DescriptionUpdate[];
  if (updates.length > MAX_UPDATES) return Response.json({ error: `Send at most ${MAX_UPDATES} checkpoints at a time` }, { status: 400 });
  if (updates.some(update => update.description.length > MAX_DESCRIPTION_LENGTH)) return Response.json({ error: `A description can be at most ${MAX_DESCRIPTION_LENGTH} characters` }, { status: 400 });

  try {
    return Response.json({ results: await updateCheckpointDescriptions(opportunityId, updates) });
  } catch (error) { return failure(error); }
}

import { mapOrgTasks, orgTaskQueries } from "../../../../../../lib/close-plan-orgchart";
import { authorizeOrgChart } from "../../../../../../lib/close-plan-orgchart-access";
import { SalesforceNotConnectedError, salesforceApi } from "../../../../../../lib/salesforce";

export const dynamic = "force-dynamic";

const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;

// The open Tasks and upcoming Events of one person on the plan's opportunity (the card's task icon). Reads Salesforce only.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorizeOrgChart((await params).id);
  if (access instanceof Response) return access;
  const queries = orgTaskQueries(access.opportunityId, new URL(request.url).searchParams.get("contact") || "");
  if (!queries) return Response.json({ error: "Not a Salesforce contact id" }, { status: 400 });
  try {
    const [tasks, events] = await Promise.all([
      query<{ Id: string; Subject: string | null; ActivityDate: string | null; Status: string | null; Owner?: { Name: string | null } | null }>(queries.tasks),
      query<{ Id: string; Subject: string | null; ActivityDateTime: string | null; Owner?: { Name: string | null } | null }>(queries.events),
    ]);
    return Response.json({ items: mapOrgTasks(tasks, events) });
  } catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: "Salesforce is not connected. Connect it under Integrations." }, { status: 409 });
    return Response.json({ error: "Salesforce could not be reached" }, { status: 502 });
  }
}

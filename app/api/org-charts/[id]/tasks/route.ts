import { mapOrgTasks, orgTaskQueries } from "../../../../lib/close-plan-orgchart";
import { loadStoredOrgChart, orgChartActor } from "../../../../lib/org-charts-store";
import { SalesforceNotConnectedError, salesforceApi } from "../../../../lib/salesforce";

export const dynamic = "force-dynamic";

const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;

// Open tasks and upcoming events of one person, on the opportunity or account the chart was imported from. Reads Salesforce only.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const row = await loadStoredOrgChart((await params).id);
  if (!row) return Response.json({ error: "Org chart not found" }, { status: 404 });
  const queries = orgTaskQueries(row.kind === "account" ? row.accountId : row.sfdcId, new URL(request.url).searchParams.get("contact") || "");
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

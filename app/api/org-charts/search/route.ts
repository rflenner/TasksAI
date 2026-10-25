import { orgSearchSoql } from "../../../lib/close-plan-orgchart";
import { orgChartActor } from "../../../lib/org-charts-store";
import { SalesforceNotConnectedError, salesforceApi } from "../../../lib/salesforce";

export const dynamic = "force-dynamic";

// Search-as-you-type for the import dialog: ?kind=account|opportunity&q=… over the connected Salesforce org.
export async function GET(request: Request) {
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const url = new URL(request.url), kind = url.searchParams.get("kind") === "account" ? "account" : "opportunity";
  const soql = orgSearchSoql(kind, url.searchParams.get("q") || "");
  if (!soql) return Response.json({ hits: [] });
  try {
    const { records } = await salesforceApi<{ records: Array<{ Id: string; Name: string | null; StageName?: string | null; Industry?: string | null; AccountId?: string | null; Account?: { Name?: string | null } | null; Owner?: { Name?: string | null } | null }> }>(`/query?q=${encodeURIComponent(soql)}`);
    return Response.json({ hits: records.map(r => ({ id: r.Id, name: r.Name || "(no name)", accountId: r.AccountId || "", account: r.Account?.Name || "", detail: kind === "account" ? r.Industry || "" : r.StageName || "", owner: r.Owner?.Name || "" })) });
  } catch (error) {
    if (error instanceof SalesforceNotConnectedError) return Response.json({ error: error.message }, { status: 409 });
    console.error("Org chart search failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Salesforce search failed" }, { status: 502 });
  }
}

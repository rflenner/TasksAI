import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../../../db";
import { orgCharts, users } from "../../../db/schema";
import { isAccountId, type OrgChart } from "../../lib/close-plan-orgchart";
import { diffOrgCharts, type OrgDiff } from "../../lib/org-chart-edit";
import { OrgChartNotFoundError, loadOrgChart, type OrgChartKind } from "../../lib/org-chart-load";
import { orgChartActor } from "../../lib/org-charts-store";
import { requireSameOrigin } from "../../lib/request";
import { SalesforceNotConnectedError } from "../../lib/salesforce";
import { isOpportunityId } from "../../lib/salesforce-opportunity-search";

export const dynamic = "force-dynamic";

// The org charts saved in Task AI, newest import first (without their data).
export async function GET() {
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const rows = await getDb().select({ id: orgCharts.id, kind: orgCharts.kind, sfdcId: orgCharts.sfdcId, name: orgCharts.name, accountName: orgCharts.accountName, people: orgCharts.people, importedAt: orgCharts.importedAt, importedBy: users.name, editedAt: orgCharts.editedAt })
    .from(orgCharts).leftJoin(users, eq(users.id, orgCharts.importedBy)).orderBy(desc(orgCharts.importedAt));
  return Response.json({ charts: rows });
}

type Item = { kind?: string; sfdcId?: string };
// Imports account and/or opportunity org charts from Salesforce: { items: [{ kind, sfdcId }] }. Importing something that was
// imported before replaces the saved copy, and throws away the edits made to it in Task AI. Reads Salesforce only.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({})) as { items?: Item[] };
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 4).map(i => ({ kind: String(i.kind), sfdcId: String(i.sfdcId || "").trim() }));
  if (!items.length) return Response.json({ error: "Choose an account or an opportunity to import" }, { status: 400 });
  const results: Array<{ kind: string; sfdcId: string; ok: boolean; id?: string; name?: string; people?: number; changes?: OrgDiff; error?: string }> = [];
  for (const item of items) {
    const kind = item.kind as OrgChartKind;
    if (!((kind === "opportunity" && isOpportunityId(item.sfdcId)) || (kind === "account" && isAccountId(item.sfdcId)))) { results.push({ ...item, ok: false, error: "Not a Salesforce id" }); continue; }
    try {
      const loaded = await loadOrgChart(kind, item.sfdcId);
      const [previous] = await getDb().select({ data: orgCharts.data }).from(orgCharts).where(and(eq(orgCharts.kind, kind), eq(orgCharts.sfdcId, item.sfdcId))).limit(1);
      const row = { id: "oc" + randomUUID().replace(/-/g, "").slice(0, 16), kind, sfdcId: item.sfdcId, name: loaded.name, accountId: loaded.accountId, accountName: loaded.accountName, data: loaded.chart, people: loaded.chart.nodes.length, importedBy: auth.actor.id, importedAt: new Date() };
      const [saved] = await getDb().insert(orgCharts).values(row)
        .onConflictDoUpdate({ target: [orgCharts.kind, orgCharts.sfdcId], set: { name: row.name, accountId: row.accountId, accountName: row.accountName, data: row.data, people: row.people, importedBy: row.importedBy, importedAt: row.importedAt, edited: null, editedAt: null, editedBy: null } })
        .returning({ id: orgCharts.id });
      results.push({ ...item, ok: true, id: saved.id, name: loaded.name, people: row.people, changes: previous ? diffOrgCharts(previous.data as OrgChart, loaded.chart) : undefined });
    } catch (error) {
      if (error instanceof SalesforceNotConnectedError) return Response.json({ error: "Salesforce is not connected. Connect it under Integrations." }, { status: 409 });
      results.push({ ...item, ok: false, error: error instanceof OrgChartNotFoundError ? "Not found in Salesforce" : "Salesforce could not be reached" });
    }
  }
  return Response.json({ results }, { status: results.some(r => r.ok) ? 201 : 502 });
}

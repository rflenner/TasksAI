import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { orgCharts } from "../../../../db/schema";
import { loadStoredOrgChart, orgChartActor } from "../../../lib/org-charts-store";
import { requireSameOrigin } from "../../../lib/request";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const row = await loadStoredOrgChart((await params).id);
  if (!row) return Response.json({ error: "Org chart not found" }, { status: 404 });
  return Response.json({ id: row.id, kind: row.kind, sfdcId: row.sfdcId, name: row.name, accountName: row.accountName, importedAt: row.importedAt, edited: Boolean(row.edited), editedAt: row.editedAt, chart: row.edited || row.data, influences: row.influences, logo: row.logo });
}

// Deletes the saved copy in Task AI. Nothing in Salesforce is touched.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const deleted = await getDb().delete(orgCharts).where(eq(orgCharts.id, (await params).id)).returning({ id: orgCharts.id });
  if (!deleted.length) return Response.json({ error: "Org chart not found" }, { status: 404 });
  return Response.json({ ok: true });
}

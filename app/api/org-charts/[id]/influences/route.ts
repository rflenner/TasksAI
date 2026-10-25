import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { orgCharts } from "../../../../../db/schema";
import type { OrgChart } from "../../../../lib/close-plan-orgchart";
import { applyInfluenceEdit, type InfluenceEdit } from "../../../../lib/org-chart-influence";
import { loadStoredOrgChart, orgChartActor } from "../../../../lib/org-charts-store";
import { requireSameOrigin } from "../../../../lib/request";

export const dynamic = "force-dynamic";

// Adds, changes, reverses or removes one influence line on a saved org chart: { op: "add" | "update" | "reverse" | "remove", ... }
// (see app/lib/org-chart-influence.ts). Saves in Task AI only. Returns all lines of the chart.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const row = await loadStoredOrgChart((await params).id);
  if (!row) return Response.json({ error: "Org chart not found" }, { status: 404 });
  const edit = await request.json().catch(() => null) as InfluenceEdit | null;
  if (!edit || typeof edit !== "object") return Response.json({ error: "Nothing to change" }, { status: 400 });
  const chart = (row.edited || row.data) as OrgChart;
  const result = applyInfluenceEdit(row.influences, new Map(chart.nodes.map(n => [n.key, n.name])), edit);
  if ("error" in result) return Response.json({ error: result.error }, { status: 422 });
  await getDb().update(orgCharts).set({ influences: result.influences }).where(eq(orgCharts.id, row.id));
  return Response.json({ influences: result.influences, id: result.id });
}

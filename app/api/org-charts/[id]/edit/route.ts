import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { orgCharts } from "../../../../../db/schema";
import type { OrgChart } from "../../../../lib/close-plan-orgchart";
import { applyOrgEdit, type OrgEdit } from "../../../../lib/org-chart-edit";
import { loadStoredOrgChart, orgChartActor } from "../../../../lib/org-charts-store";
import { requireSameOrigin } from "../../../../lib/request";

export const dynamic = "force-dynamic";

// Edits the copy of an org chart in Task AI: { op: "move" | "shift" | "update" | "add" | "remove", ... } (see app/lib/org-chart-edit.ts).
// Saves only here; nothing is written to Salesforce. Returns the whole changed chart.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const row = await loadStoredOrgChart((await params).id);
  if (!row) return Response.json({ error: "Org chart not found" }, { status: 404 });
  const edit = await request.json().catch(() => null) as OrgEdit | null;
  if (!edit || typeof edit !== "object") return Response.json({ error: "Nothing to change" }, { status: 400 });
  const current = (row.edited || row.data) as OrgChart & { salesforceBase?: string };
  const result = applyOrgEdit(current, edit);
  if ("error" in result) return Response.json({ error: result.error }, { status: 422 });
  const next = { ...result.chart, salesforceBase: current.salesforceBase || "" };
  await getDb().update(orgCharts).set({ edited: next, editedAt: new Date(), editedBy: auth.actor.id, people: next.nodes.length }).where(eq(orgCharts.id, row.id));
  return Response.json({ chart: next, key: result.key });
}

// Throws the edits away: the chart is the copy from Salesforce again.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const row = await loadStoredOrgChart((await params).id);
  if (!row) return Response.json({ error: "Org chart not found" }, { status: 404 });
  const original = row.data as OrgChart;
  await getDb().update(orgCharts).set({ edited: null, editedAt: null, editedBy: null, people: original.nodes.length }).where(eq(orgCharts.id, row.id));
  return Response.json({ chart: original });
}

import { loadStoredOrgChart, orgChartActor } from "../../../../../lib/org-charts-store";
import { contactPhotoResponse } from "../../../../../lib/org-chart-photo";

export const dynamic = "force-dynamic";

// A contact's picture for a saved org chart (app/lib/org-chart-photo.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const auth = await orgChartActor(); if ("response" in auth) return new Response(null, { status: auth.response?.status ?? 401 });
  const { id, attachmentId } = await params;
  if (!(await loadStoredOrgChart(id))) return new Response(null, { status: 404 });
  return contactPhotoResponse(attachmentId);
}

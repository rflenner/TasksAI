import { requireSameOrigin } from "../../../../lib/request";
import { syncSalesAI } from "../../../../lib/sales-ai-sync";
import { currentActor } from "../../../../lib/session";

// Manual trigger only, for now — no cron yet. Defaults to today only
// (both start and end) per the explicit "let's see what we get first"
// request this was built against; a caller can still pass an explicit
// window later once the first result's been reviewed.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { startDate?: string; endDate?: string };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const result = await syncSalesAI({ startDate: body.startDate || today, endDate: body.endDate || today, initiatedBy: actor.name });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sales AI sync failed" }, { status: 502 });
  }
}

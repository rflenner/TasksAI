import { desc } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { salesAiSyncRuns } from "../../../../../db/schema";
import { currentActor } from "../../../../lib/session";

// Read side of the sync log on /integrations — covers both manual runs
// (POST /api/integrations/sales-ai/sync) and the 6x/day cron
// (scripts/sync-sales-ai.ts), since both write into salesAiSyncRuns
// through the one shared syncSalesAI() call. Newest first, capped at 50 —
// plenty for a first pass at this (the cron alone is at most 6/day), and
// simpler than adding real pagination before anyone's asked for history
// past that.
const RUN_LIMIT = 50;

export async function GET() {
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const runs = await getDb().select().from(salesAiSyncRuns).orderBy(desc(salesAiSyncRuns.runAt)).limit(RUN_LIMIT);
  return Response.json({ runs });
}

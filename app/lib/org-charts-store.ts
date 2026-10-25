import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { orgCharts } from "../../db/schema";
import { canCreatePlan } from "./close-plan-store";
import { currentActor } from "./session";

// Org charts in Task AI are for the admins who can create Close Plans: they hold customer names and contact details
// read from Salesforce with the workspace connection.
export async function orgChartActor() {
  const actor = await currentActor();
  if (!actor) return { response: Response.json({ error: "Sign in required" }, { status: 401 }) } as const;
  if (!canCreatePlan(actor)) return { response: Response.json({ error: "Admin access required" }, { status: 403 }) } as const;
  return { actor } as const;
}

export async function loadStoredOrgChart(id: string) {
  const [row] = await getDb().select().from(orgCharts).where(eq(orgCharts.id, id)).limit(1);
  return row || null;
}

import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments, companies, users } from "../../../../../../db/schema";
import { accountIdForPlan } from "../../../../../lib/close-plan-opportunities";
import { accountContacts, opportunityIndex } from "../../../../../lib/close-plan-sales-ai";
import { canAccessPlan } from "../../../../../lib/close-plan-store";
import { currentActor } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

// Who can be added to this plan: the active Task AI users, and the contacts Sales
// AI has for the plan's account. For everyone on the plan's iSEEit team (canAccessPlan:
// admins, the creator and the members), so any of them can add people. Contacts being unavailable (no
// account found, Sales AI down) never blocks adding Task AI users or new contacts.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const [row] = await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, id)).limit(1);
  if (!row || row.deletedAt || !canAccessPlan(actor, row)) return Response.json({ error: "Plan not found" }, { status: 404 });

  const userRows = await getDb().select({ id: users.id, name: users.name, email: users.email, company: companies.name })
    .from(users).leftJoin(companies, eq(companies.id, users.companyId)).where(eq(users.status, "active")).orderBy(asc(users.name));

  let contacts: Array<{ name: string; title: string; email: string; contactIds: string[] }> = [];
  let contactsStatus: "ok" | "no_account" | "unavailable" = "ok";
  try {
    const { opportunities, accountNameById } = await opportunityIndex();
    const accountId = accountIdForPlan(row.data, opportunities, accountNameById);
    if (accountId) contacts = await accountContacts(accountId); else contactsStatus = "no_account";
  } catch (error) {
    console.error("Close Plan people options: Sales AI contacts failed:", error instanceof Error ? error.message : error);
    contactsStatus = "unavailable";
  }
  return Response.json({ users: userRows.map(u => ({ id: u.id, name: u.name, email: u.email, company: u.company || "" })), contacts, contactsStatus });
}

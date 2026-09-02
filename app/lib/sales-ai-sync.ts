import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { contacts, tasks, users } from "../../db/schema";
import { fetchAllPages } from "./sales-ai-client";
import { extractContacts, involvesRegisteredUser, mapActionItemToTask, type SalesAIActionItem } from "./sales-ai-mapping";

type SalesAIAccount = { account_id: string; account_name: string };
type SalesAIOpportunity = { opportunity_id: string; opportunity_name: string };

export type SalesAISyncResult = {
  itemsFound: number;
  qualifying: number;
  created: number;
  alreadySynced: number;
  contactsUpserted: number;
};

// First real run of this sync, deliberately cautious: a manual trigger
// only, scoped to whatever window the caller passes (today, for the first
// test — see app/api/integrations/sales-ai/sync/route.ts), and an already-
// synced item (matched by externalId) is just skipped rather than updated.
// Re-syncing to pick up a status change on Sales AI's side is a real gap,
// left for a later pass once there's been a chance to see what a first
// sync actually produces, per the explicit "let's see what we get first"
// request this was built against.
export async function syncSalesAI({ startDate, endDate }: { startDate: string; endDate?: string }): Promise<SalesAISyncResult> {
  const apiKey = process.env.SALES_AI_API_KEY;
  const baseUrl = process.env.SALES_AI_BASE_URL;
  if (!apiKey || !baseUrl) throw new Error("Sales AI is not configured — SALES_AI_API_KEY/SALES_AI_BASE_URL are missing");

  const dateParams = { start_date: startDate, ...(endDate ? { end_date: endDate } : {}) };
  const [items, accountRows, opportunityRows, activeUsers] = await Promise.all([
    fetchAllPages<SalesAIActionItem>(baseUrl, apiKey, "action-items", dateParams),
    fetchAllPages<SalesAIAccount>(baseUrl, apiKey, "accounts"),
    fetchAllPages<SalesAIOpportunity>(baseUrl, apiKey, "opportunities"),
    getDb().select({ name: users.name, email: users.email }).from(users).where(eq(users.status, "active")),
  ]);

  const accountNameById = new Map(accountRows.map(row => [row.account_id, row.account_name]));
  const opportunityNameById = new Map(opportunityRows.map(row => [row.opportunity_id, row.opportunity_name]));
  const registeredNameByEmail = new Map(activeUsers.map(user => [user.email.trim().toLowerCase(), user.name]));
  const registeredEmails = new Set(registeredNameByEmail.keys());

  const qualifying = items.filter(item => involvesRegisteredUser(item, registeredEmails));

  let created = 0, alreadySynced = 0, contactsUpserted = 0;
  for (const item of qualifying) {
    const [existing] = await getDb().select({ id: tasks.id }).from(tasks).where(and(eq(tasks.externalSource, "sales-ai"), eq(tasks.externalId, item.action_item_id))).limit(1);
    if (existing) { alreadySynced++; continue; }

    const mapped = mapActionItemToTask(item, { registeredNameByEmail, accountNameById, opportunityNameById });
    await getDb().insert(tasks).values({ ...mapped, topic: "", project: "", recurringMeeting: "", updates: [], closedAt: mapped.status === "Closed" ? new Date() : null }).onConflictDoNothing();
    created++;

    for (const candidate of extractContacts(item, accountNameById)) {
      await getDb().insert(contacts).values({ ...candidate, updatedAt: new Date() })
        .onConflictDoUpdate({ target: contacts.salesAiContactId, set: { name: candidate.name, email: candidate.email, salesAiAccountId: candidate.salesAiAccountId, salesAiAccountName: candidate.salesAiAccountName, updatedAt: new Date() } });
      contactsUpserted++;
    }
  }

  return { itemsFound: items.length, qualifying: qualifying.length, created, alreadySynced, contactsUpserted };
}

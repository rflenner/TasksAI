import { fetchAllPages } from "./sales-ai-client";
import { mergeContacts, type PlanContact, type SalesAIContactRow, type SalesAIOpportunityRow } from "./close-plan-opportunities";

// Sales AI's export API only filters opportunities by an exact name, so
// search-as-you-type needs the whole list locally. Fetched once (about 700
// rows today = 7 pages of 100) and kept in memory for CACHE_MS, so typing in
// the Close Plan guide costs no Sales AI requests at all after the first
// keystroke — the API allows 100 requests per rate-limit window.
const CACHE_MS = 10 * 60 * 1000;
type OpportunityIndex = { at: number; opportunities: SalesAIOpportunityRow[]; accountNameById: Map<string, string> };
let cache: OpportunityIndex | null = null;
let inFlight: Promise<OpportunityIndex> | null = null;

function credentials() {
  const apiKey = process.env.SALES_AI_API_KEY, baseUrl = process.env.SALES_AI_BASE_URL;
  if (!apiKey || !baseUrl) throw new Error("Sales AI is not configured — SALES_AI_API_KEY/SALES_AI_BASE_URL are missing");
  return { apiKey, baseUrl };
}

export async function opportunityIndex(): Promise<OpportunityIndex> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  // Concurrent first keystrokes share one fetch instead of each starting their own.
  inFlight ??= (async () => {
    const { apiKey, baseUrl } = credentials();
    const [opportunities, accounts] = await Promise.all([
      fetchAllPages<SalesAIOpportunityRow>(baseUrl, apiKey, "opportunities"),
      fetchAllPages<{ account_id: string; account_name: string }>(baseUrl, apiKey, "accounts"),
    ]);
    const fresh: OpportunityIndex = { at: Date.now(), opportunities, accountNameById: new Map(accounts.map(a => [a.account_id, a.account_name])) };
    cache = fresh;
    return fresh;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

// One account's contacts, duplicates merged (see mergeContacts). Not cached:
// it's one request per opportunity picked, and the result should reflect
// contacts added in Sales AI a minute ago.
export async function accountContacts(accountId: string): Promise<PlanContact[]> {
  const { apiKey, baseUrl } = credentials();
  const rows = await fetchAllPages<SalesAIContactRow>(baseUrl, apiKey, "contacts", { account_id: accountId });
  return mergeContacts(rows);
}

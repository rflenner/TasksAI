// Finding a Salesforce opportunity by name or account (the Playground used to
// need its ID pasted in). Pure so the query building, the one place user text
// goes into SOQL (which has no bind parameters over REST), is unit-tested
// (tests/salesforce-opportunity-search.test.ts).

export type OpportunityHit = { id: string; name: string; account: string; stage: string; closeDate: string | null; owner: string };
type SfOpportunity = { Id: string; Name: string | null; StageName: string | null; CloseDate: string | null; Account?: { Name?: string | null } | null; Owner?: { Name?: string | null } | null };

export const SEARCH_MIN = 2, SEARCH_MAX_WORDS = 4, SEARCH_LIMIT = 10;
export const isOpportunityId = (value: string) => /^006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(value.trim());

// Only letters, digits, spaces and . , & ' - survive; that removes the LIKE wildcards (% _) and every character
// that could end a string literal, and the one quote left is escaped.
const words = (query: string) => query.normalize("NFKC").replace(/[^\p{L}\p{N} .,&'-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, SEARCH_MAX_WORDS);
const literal = (word: string) => word.replace(/'/g, "\\'");

export function opportunitySearchSoql(query: string): string | null {
  const parts = words(query);
  if (!parts.length || parts.join(" ").length < SEARCH_MIN) return null;
  const match = parts.map(w => `(Name LIKE '%${literal(w)}%' OR Account.Name LIKE '%${literal(w)}%')`).join(" AND ");
  return `SELECT Id, Name, StageName, CloseDate, Account.Name, Owner.Name FROM Opportunity WHERE ${match} ORDER BY LastModifiedDate DESC LIMIT ${SEARCH_LIMIT}`;
}

export function mapOpportunities(records: SfOpportunity[]): OpportunityHit[] {
  return records.map(r => ({ id: r.Id, name: r.Name || "(no name)", account: r.Account?.Name || "", stage: r.StageName || "", closeDate: r.CloseDate || null, owner: r.Owner?.Name || "" }));
}

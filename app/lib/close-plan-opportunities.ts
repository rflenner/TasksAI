// Sales AI opportunity search and contact clean-up for the Close Plan
// "New close plan" guide (app/close-plans, app/api/close-plans/*). Pure and
// DB-free, same split as sales-ai-mapping.ts: the routes do the fetching,
// this decides what matches and how duplicate contacts collapse.
import { cleanName, fullerName } from "./sales-ai-mapping";

export type SalesAIOpportunityRow = { opportunity_id: string; opportunity_name: string; account_id?: string | null; stage?: string | null; amount?: number | null; close_date?: string | null };
export type SalesAIContactRow = { contact_id: string; contact_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null; title?: string | null };

export type OpportunityHit = { id: string; name: string; accountId: string | null; accountName: string; stage: string; amount: number | null; closeDate: string | null; open: boolean };
export type PlanContact = { name: string; title: string; email: string; contactIds: string[] };

export const SEARCH_LIMIT = 15;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
// Sales AI stage names come from Salesforce ("Closed Won", "Closed Lost").
export const isOpenStage = (stage?: string | null) => !/^closed\b/i.test(stage || "");

// Every word typed must appear in the opportunity or account name. Ranked:
// open deals before closed ones, then a name that starts with the query,
// then the nearest close date (undated last).
export function searchOpportunities(rows: SalesAIOpportunityRow[], accountNameById: Map<string, string>, query: string, limit = SEARCH_LIMIT): OpportunityHit[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const q = norm(query);
  const hits = rows.map(row => {
    const accountName = (row.account_id && accountNameById.get(row.account_id)) || "";
    const hay = norm(`${row.opportunity_name} ${accountName}`);
    if (!words.every(w => hay.includes(w))) return null;
    const starts = norm(row.opportunity_name).startsWith(q) || norm(accountName).startsWith(q);
    const hit: OpportunityHit = { id: row.opportunity_id, name: row.opportunity_name, accountId: row.account_id || null, accountName, stage: row.stage || "", amount: row.amount ?? null, closeDate: row.close_date ? row.close_date.slice(0, 10) : null, open: isOpenStage(row.stage) };
    return { hit, starts };
  }).filter((x): x is { hit: OpportunityHit; starts: boolean } => Boolean(x));
  hits.sort((a, b) => Number(b.hit.open) - Number(a.hit.open) || Number(b.starts) - Number(a.starts) || (a.hit.closeDate || "9999").localeCompare(b.hit.closeDate || "9999") || a.hit.name.localeCompare(b.hit.name));
  return hits.slice(0, limit).map(x => x.hit);
}

// Collapses the duplicates Sales AI really has for one person: a full record,
// an email-only record (name = the email address) and a name-only record
// (name = the email's local part, e.g. "first.last"). Grouped by email
// first, then name-only records join the group whose email local part or
// name they match. Keeps the fullest name and the first non-empty title.
export function mergeContacts(rows: SalesAIContactRow[]): PlanContact[] {
  const groups: PlanContact[] = [];
  const nameOf = (r: SalesAIContactRow) => cleanName(r.contact_name || [r.first_name, r.last_name].filter(Boolean).join(" "));
  const localPart = (email: string) => email.split("@")[0].toLowerCase();
  const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+$/.test(s);
  const looksLikeHandle = (s: string) => /^[a-z0-9]+([._-][a-z0-9]+)+$/i.test(s);
  const pretty = (s: string) => looksLikeEmail(s) || looksLikeHandle(s) ? "" : s;
  const add = (g: PlanContact, r: SalesAIContactRow, name: string) => {
    g.name = fullerName(g.name, pretty(name));
    if (!g.title && r.title) g.title = r.title.trim();
    if (!g.email && r.email) g.email = r.email.trim().toLowerCase();
    g.contactIds.push(r.contact_id);
  };
  const byEmail = (email: string) => groups.find(g => g.email === email);
  const withEmail = rows.filter(r => r.email), without = rows.filter(r => !r.email);
  for (const r of withEmail) {
    const email = String(r.email).trim().toLowerCase(), name = nameOf(r);
    const g = byEmail(email);
    if (g) add(g, r, name); else { const n: PlanContact = { name: "", title: "", email: "", contactIds: [] }; add(n, r, name); groups.push(n); }
  }
  for (const r of without) {
    const name = nameOf(r), key = norm(name).replace(/\s+/g, ".");
    const g = groups.find(x => (x.email && localPart(x.email) === key) || (x.name && norm(x.name) === norm(name)) || (x.email && norm(name) === x.email));
    if (g) add(g, r, name);
    else if (name) { const n: PlanContact = { name: "", title: "", email: "", contactIds: [] }; add(n, r, name); groups.push(n); }
  }
  // A group that only ever had an address for a name gets a readable one from it.
  for (const g of groups) if (!g.name && g.email) g.name = localPart(g.email).split(/[._-]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
  return groups.filter(g => g.name).sort((a, b) => a.name.localeCompare(b.name));
}

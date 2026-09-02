// Pure mapping logic for the Sales AI → Task AI sync — no DB, no network,
// fully testable against the exact real-data shapes confirmed live before
// this was written. Kept separate from sales-ai-sync.ts (the DB/network
// orchestration) the same way every other sync piece this session split
// pure decision logic from I/O (data-hygiene.ts, activity-meter.ts, etc.).

export type SalesAIRecipient = { contact_id?: string | null; name?: string | null; email?: string | null };
export type SalesAIActionItem = {
  action_item_id: string;
  description: string;
  notes?: string | null;
  citation?: { user?: string | null; quote?: string | null } | null;
  due_date?: string | null;
  status: "open" | "overdue" | "completed";
  created_at: string;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  recipients?: SalesAIRecipient[] | null;
  account_id?: string | null;
  opportunity_id?: string | null;
  meeting_id?: string | null;
};

// Strips the stray-quote/double-space artifacts confirmed live in real
// Sales AI data (e.g. a name arriving as "'Avni  Bardiya'").
export function cleanName(name?: string | null): string {
  if (!name) return "";
  return name.trim().replace(/^['"]+|['"]+$/g, "").replace(/\s+/g, " ").trim();
}

// Registered Task AI users take priority over Sales AI's own name (keeps
// synced tasks consistent with how that person's name already appears
// everywhere else in Task AI); falls back to Sales AI's name, cleaned,
// when there's no registered match — the same free-text-person model
// every other part of this app already uses.
export function resolvePersonName(email: string | null | undefined, rawName: string | null | undefined, registeredNameByEmail: Map<string, string>): string {
  const cleaned = cleanName(rawName);
  const matched = email ? registeredNameByEmail.get(email.trim().toLowerCase()) : undefined;
  return matched || cleaned;
}

// Whether this action item should be synced at all — true if the owner or
// any recipient's email matches a registered Task AI account. Confirmed
// scope decision: don't import everything Sales AI has, only what's
// relevant to people actually using Task AI.
export function involvesRegisteredUser(item: SalesAIActionItem, registeredEmails: Set<string>): boolean {
  const emails = [item.owner_email, ...((item.recipients || []).map(r => r.email))]
    .filter((email): email is string => Boolean(email))
    .map(email => email.trim().toLowerCase());
  return emails.some(email => registeredEmails.has(email));
}

export type MappedTask = {
  subject: string; description: string; owner: string; recipients: string[]; collaborators: string[];
  due: string; status: "Open" | "Closed"; source: string; created: string; createdBy: string;
  externalSource: "sales-ai"; externalId: string;
  accountId: string | null; accountName: string | null;
  opportunityId: string | null; opportunityName: string | null;
  meetingId: string | null; citationUser: string | null; citationQuote: string | null;
};

export type NameResolution = {
  registeredNameByEmail: Map<string, string>;
  accountNameById: Map<string, string>;
  opportunityNameById: Map<string, string>;
};

// The full field mapping confirmed against real data — see conversation
// on 2026-09-02 for how each of these was checked before being included.
export function mapActionItemToTask(item: SalesAIActionItem, lookup: NameResolution): MappedTask {
  const owner = resolvePersonName(item.owner_email, item.owner_name, lookup.registeredNameByEmail) || "Unassigned";
  const recipients = (item.recipients || [])
    .map(recipient => resolvePersonName(recipient.email, recipient.name, lookup.registeredNameByEmail))
    .filter(Boolean);
  return {
    subject: item.description.slice(0, 140),
    description: item.notes || item.description,
    owner,
    recipients,
    collaborators: [], // no Sales AI equivalent — confirmed live, only owner + recipients exist
    due: item.due_date ? item.due_date.slice(0, 10) : "",
    status: item.status === "completed" ? "Closed" : "Open",
    source: "Sales AI",
    created: item.created_at,
    createdBy: "Sales AI sync",
    externalSource: "sales-ai",
    externalId: item.action_item_id,
    accountId: item.account_id || null,
    accountName: item.account_id ? (lookup.accountNameById.get(item.account_id) || null) : null,
    opportunityId: item.opportunity_id || null,
    opportunityName: item.opportunity_id ? (lookup.opportunityNameById.get(item.opportunity_id) || null) : null,
    meetingId: item.meeting_id || null, // stored raw — no name resolvable, confirmed live (no meetings scope)
    citationUser: item.citation?.user || null,
    citationQuote: item.citation?.quote || null,
  };
}

export type ContactCandidate = { name: string; email: string | null; salesAiContactId: string; salesAiAccountId: string | null; salesAiAccountName: string | null };

// Every distinct person (owner + each recipient) worth upserting into the
// contacts registry — anyone with a Sales AI contact id, which is the
// match key contacts are keyed on. owner_id turned out to be the same
// Salesforce-contact-id shape as recipients[].contact_id (both start with
// the same object-key prefix), so it's treated the same way here.
export function extractContacts(item: SalesAIActionItem, accountNameById: Map<string, string>): ContactCandidate[] {
  const accountName = item.account_id ? accountNameById.get(item.account_id) || null : null;
  const candidates: ContactCandidate[] = [];
  if (item.owner_id) candidates.push({ name: cleanName(item.owner_name), email: item.owner_email || null, salesAiContactId: item.owner_id, salesAiAccountId: item.account_id || null, salesAiAccountName: accountName });
  for (const recipient of item.recipients || []) {
    if (!recipient.contact_id) continue;
    candidates.push({ name: cleanName(recipient.name), email: recipient.email || null, salesAiContactId: recipient.contact_id, salesAiAccountId: item.account_id || null, salesAiAccountName: accountName });
  }
  return candidates;
}

import { linkedinUrl } from "./close-plan-orgchart";

// LinkedIn enrichment for org charts. LinkedIn itself has no API for reading other people's profiles, so the data comes from
// Enrich Layer (https://enrichlayer.com/docs/api/v2, key in ENRICH_LAYER_API_KEY), and Sales AI is asked first for a profile
// link it already holds. Nothing here writes anywhere: it only returns suggestions that the person reviewing the chart accepts.
// The pure helpers are tested in tests/org-chart-linkedin.test.ts.
const BASE = "https://enrichlayer.com/api/v2";
export const MAX_CHECK = 40; // profile lookups cost a credit each, so one check is capped

export type LiExperience = { company: string; title: string; current: boolean; start: string };
export type LiProfile = { url: string; name: string; headline: string; photo: string; experiences: LiExperience[] };

type RawDate = { year?: number | null; month?: number | null } | null | undefined;
type RawProfile = { public_identifier?: string | null; full_name?: string | null; first_name?: string | null; last_name?: string | null; headline?: string | null; occupation?: string | null; profile_pic_url?: string | null; experiences?: Array<{ company?: string | null; title?: string | null; starts_at?: RawDate; ends_at?: RawDate }> | null };

const dateKey = (d: RawDate) => d?.year ? `${d.year}-${String(d.month || 1).padStart(2, "0")}` : "";

export function parseProfile(raw: RawProfile | null | undefined, url = ""): LiProfile | null {
  if (!raw) return null;
  const name = (raw.full_name || [raw.first_name, raw.last_name].filter(Boolean).join(" ")).trim();
  const link = linkedinUrl(url) || (raw.public_identifier ? `https://www.linkedin.com/in/${raw.public_identifier}` : "");
  if (!name && !link) return null;
  const experiences = (raw.experiences || []).map(e => ({ company: (e.company || "").trim(), title: (e.title || "").trim(), current: !e.ends_at?.year, start: dateKey(e.starts_at) }));
  return { url: link, name, headline: (raw.headline || raw.occupation || "").trim(), photo: raw.profile_pic_url || "", experiences };
}

// "Acme Inc." and "ACME" are the same company; "Acme Pharma Group" is taken as the same as "Acme Pharma".
const LEGAL = new Set(["inc", "incorporated", "llc", "ltd", "limited", "gmbh", "ag", "sa", "bv", "nv", "plc", "corp", "corporation", "co", "company", "group", "holding", "holdings", "the", "und", "kg", "sarl", "srl", "spa", "oy", "ab", "as", "a/s"]);
export const companyWords = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9/ ]+/g, " ").split(/\s+/).filter(w => w && !LEGAL.has(w));
export function sameCompany(a: string, b: string) {
  const x = companyWords(a), y = companyWords(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every(w => long.includes(w)) && (short.length > 1 || short[0].length >= 3);
}

export type Standing = { status: "current" | "left" | "unknown"; title: string; company: string };
// Is the person still at the account? "current": a job without an end date at that company. "left": the profile lists jobs but
// none that is current there. "unknown": no job history to go by (private or empty profile), so nothing is suggested.
export function standing(profile: LiProfile, accountName: string): Standing {
  if (!accountName || !profile.experiences.length) return { status: "unknown", title: "", company: "" };
  const here = profile.experiences.filter(e => e.current && sameCompany(e.company, accountName)).sort((a, b) => b.start.localeCompare(a.start))[0];
  if (here) return { status: "current", title: here.title, company: here.company };
  const now = profile.experiences.filter(e => e.current).sort((a, b) => b.start.localeCompare(a.start))[0];
  // Only jobs at the account are in the history, all ended: probably left, but there is no new employer to name.
  return { status: "left", title: "", company: now?.company || "" };
}

export type Suggestion = {
  id: string; key: string; name: string;
  kind: "left" | "back" | "title" | "url";
  from: string; to: string; detail: string;
  linkedin: string; // the profile the suggestion rests on
};
type NodeLike = { key: string; name: string; title: string; linkedin: string; left: boolean };

// Turns what LinkedIn says about one person into at most one suggestion each for "left", "back" and "title".
export function suggestFor(node: NodeLike, profile: LiProfile, accountName: string): Suggestion[] {
  const out: Suggestion[] = [], st = standing(profile, accountName);
  const base = { key: node.key, name: node.name, linkedin: profile.url || node.linkedin };
  if (st.status === "left" && !node.left) out.push({ ...base, id: `${node.key}:left`, kind: "left", from: "", to: st.company, detail: st.company ? `LinkedIn shows ${node.name} at ${st.company} now, no longer at ${accountName}.` : `LinkedIn shows no current job at ${accountName} for ${node.name}.` });
  if (st.status === "current" && node.left) out.push({ ...base, id: `${node.key}:back`, kind: "back", from: "", to: "", detail: `The contact is marked as having left, but LinkedIn shows ${node.name} still at ${accountName}.` });
  if (st.status === "current" && st.title && norm(st.title) !== norm(node.title)) out.push({ ...base, id: `${node.key}:title`, kind: "title", from: node.title, to: st.title, detail: node.title ? `Title on LinkedIn differs from the chart.` : `The chart has no title for ${node.name}.` });
  return out;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A name from the chart as first and last name: the last word is the last name, which is right for most western names.
export function splitName(name: string) {
  const words = name.replace(/\([^)]*\)/g, " ").replace(/,.*$/, "").trim().split(/\s+/).filter(Boolean);
  return words.length < 2 ? { first: words[0] || "", last: "" } : { first: words.slice(0, -1).join(" "), last: words[words.length - 1] };
}

export function domainOf(website: string | null | undefined) {
  if (!website) return "";
  try { return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; }
}

// --- Enrich Layer ---------------------------------------------------------------------------------------------------------
export class EnrichNotConfiguredError extends Error { constructor() { super("LinkedIn enrichment is not set up: ENRICH_LAYER_API_KEY is missing."); } }
export const enrichConfigured = () => Boolean(process.env.ENRICH_LAYER_API_KEY);

async function enrich<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = process.env.ENRICH_LAYER_API_KEY;
  if (!key) throw new EnrichNotConfiguredError();
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60000) });
  if (response.status === 404) return null; // no such profile
  if (response.status === 401 || response.status === 403) throw new Error("Enrich Layer refused the key (check ENRICH_LAYER_API_KEY).");
  if (response.status === 402) throw new Error("Enrich Layer is out of credits.");
  if (response.status === 429) throw new Error("Enrich Layer rate limit reached; try again in a minute.");
  if (!response.ok) throw new Error(`Enrich Layer request failed (${response.status})`);
  return await response.json() as T;
}

export async function fetchProfile(url: string): Promise<LiProfile | null> {
  const clean = linkedinUrl(url); if (!clean) return null;
  const raw = await enrich<RawProfile>("/profile", { profile_url: clean, use_cache: "if-present", fallback_to_cache: "on-error" });
  return parseProfile(raw, clean);
}

// Finds one person's profile from a name and the company's web domain.
export async function resolveProfile(name: string, companyDomain: string, title = "", strict = true): Promise<LiProfile | null> {
  const { first, last } = splitName(name);
  if (!first || !companyDomain) return null;
  const res = await enrich<{ url?: string | null; profile?: RawProfile | null; name_similarity_score?: number | null; company_similarity_score?: number | null }>("/profile/resolve", { company_domain: companyDomain, first_name: first, last_name: last, title, similarity_checks: "include", enrich_profile: "enrich" });
  // Both scores must be there and decent: a wrong person suggested for a real contact is worse than none.
  if (!res?.url) return null;
  // When a person picks from a list (strict = false) a weaker match is shown rather than hidden.
  if (strict && ((res.name_similarity_score ?? 0) < 0.8 || (res.company_similarity_score ?? 0) < 0.6)) return null;
  return parseProfile(res.profile, res.url);
}

export type SearchInput = { first?: string; last?: string; position?: string; companyName: string; companyDomain?: string; url?: string; nextToken?: string };
// New people for the chart, the way Sales AI's "add contact" looks them up: a profile link is read directly; first and last name
// with the company's web domain is a person lookup; anything else (a lone name, a position) is a search among the company's
// people, five at a time, continued with the returned token.
export async function searchPeople(input: SearchInput): Promise<{ people: LiProfile[]; nextToken: string }> {
  if (input.url) { const p = await fetchProfile(input.url); return { people: p ? [p] : [], nextToken: "" }; }
  const first = (input.first || "").trim(), last = (input.last || "").trim();
  if (!first && !last && !input.position) return { people: [], nextToken: "" };
  if (first && last && input.companyDomain && !input.nextToken) {
    const p = await resolveProfile(`${first} ${last}`, input.companyDomain, input.position || "", false);
    if (p) return { people: [p], nextToken: "" };
  }
  // The filters are Enrich Layer "search expressions" (boolean syntax): "-" means NOT and AND/OR are operators, so a company name is
  // sent as an exact phrase. A search page costs 3 credits per person plus 1 for the profile data.
  const phrase = (v: string) => `"${v.replace(/["()]/g, " ").replace(/\s+/g, " ").trim()}"`;
  const run = (company: Record<string, string>) => enrich<{ results?: Array<{ linkedin_profile_url?: string | null; profile?: RawProfile | null }>; next_page?: string | null }>("/search/person", {
    ...company, first_name: first, last_name: last, current_role_title: input.position || "", page_size: "5", enrich_profiles: "enrich", use_cache: "if-present", next_token: input.nextToken || "",
  });
  // Salesforce says "CS Disco Inc." where LinkedIn says "CS Disco": an exact phrase needs the name without its legal ending too.
  const plain = companyWords(input.companyName).join(" ");
  const names = [...new Set([input.companyName, plain].map(n => n.trim()).filter(Boolean))];
  let res: Awaited<ReturnType<typeof run>> = null;
  if (input.nextToken) res = await run({});
  else {
    for (const n of names) { res = await run({ current_company_name: phrase(n) }); if (res?.results?.length) break; }
    // The company may be listed under yet another name on LinkedIn: try its web domain.
    if (!res?.results?.length && input.companyDomain) res = await run({ current_company_domain_name: input.companyDomain });
  }
  let nextToken = "";
  try { nextToken = res?.next_page ? new URL(res.next_page).searchParams.get("next_token") || "" : ""; } catch { /* no more pages */ }
  return { people: (res?.results || []).map(r => parseProfile(r.profile, r.linkedin_profile_url || "")).filter((p): p is LiProfile => Boolean(p)), nextToken };
}

// --- Sales AI ------------------------------------------------------------------------------------------------------------
// The profile link Sales AI already holds for a contact, looked up by email. Which field carries it is not documented, so the
// likely names are tried; if none is there this returns "" and Enrich Layer is used.
export async function salesAiLinkedin(email: string): Promise<string> {
  const apiKey = process.env.SALES_AI_API_KEY, base = process.env.SALES_AI_BASE_URL;
  if (!apiKey || !base || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/contacts?email=${encodeURIComponent(email)}&limit=1`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return "";
    const row = ((await response.json()) as { data?: Array<Record<string, unknown>> }).data?.[0];
    if (!row) return "";
    return linkedinUrl(...["linkedin_url", "linkedin_profile_url", "linkedin", "linkedin_profile"].map(k => typeof row[k] === "string" ? row[k] as string : ""));
  } catch { return ""; }
}

// Runs `work` over the items a few at a time, keeping the order of the results.
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]); } }));
  return out;
}

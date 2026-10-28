import type { OrgChart } from "../../../../lib/close-plan-orgchart";
import { isAccountId, linkedinUrl } from "../../../../lib/close-plan-orgchart";
import {
  EnrichNotConfiguredError, MAX_CHECK, domainOf, enrichConfigured, fetchProfile, mapLimit, resolveProfile, salesAiLinkedin, searchPeople, suggestFor, type LiProfile, type Suggestion,
} from "../../../../lib/org-chart-linkedin";
import { loadStoredOrgChart, orgChartActor } from "../../../../lib/org-charts-store";
import { requireSameOrigin } from "../../../../lib/request";
import { salesforceApi } from "../../../../lib/salesforce";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONTACT_ID = /^003[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const query = async <T,>(soql: string) => (await salesforceApi<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`)).records;
const card = (p: LiProfile) => ({ url: p.url, name: p.name, headline: p.headline, photo: p.photo, title: p.experiences.find(e => e.current)?.title || "", company: p.experiences.find(e => e.current)?.company || "" });

// LinkedIn enrichment for one org chart. Reads only; the answers are suggestions that the page applies through the edit route.
//   { action: "status" }                                  is enrichment set up?
//   { action: "check" }                                   suggestions for the people in the chart (left, back, title, missing profile link)
//   { action: "search", name?, position?, url? }          people who could be added to the chart
//   { action: "writeback", key, left?, title?, linkedin? } the accepted change on the Salesforce Contact (only on the person's own request)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const auth = await orgChartActor(); if ("response" in auth) return auth.response;
  const row = await loadStoredOrgChart((await params).id);
  if (!row) return Response.json({ error: "Org chart not found" }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  const chart = (row.edited || row.data) as OrgChart;
  try {
    if (action === "status") return Response.json({ configured: enrichConfigured(), accountName: row.accountName });

    if (action === "writeback") {
      const key = String(body?.key || "");
      if (!CONTACT_ID.test(key) || !chart.nodes.some(n => n.key === key)) return Response.json({ error: "That person is not a Salesforce contact on this chart" }, { status: 422 });
      const fields: Record<string, unknown> = {};
      if (typeof body?.left === "boolean") fields.iseeit__Is_Company_Left__c = body.left;
      if (typeof body?.title === "string" && body.title.trim()) fields.Title = body.title.trim().slice(0, 128);
      const link = typeof body?.linkedin === "string" ? linkedinUrl(body.linkedin) : "";
      if (link) {
        // The contact has two link fields; the one that already holds a value is the one to keep current.
        const [c] = await query<{ iseeit__LinkedIn_Profile__c: string | null }>(`SELECT iseeit__LinkedIn_Profile__c FROM Contact WHERE Id = '${key}'`);
        fields[c?.iseeit__LinkedIn_Profile__c ? "iseeit__LinkedIn_Profile__c" : "iseeit__Linkedin_Profile_Url__c"] = link;
      }
      if (!Object.keys(fields).length) return Response.json({ error: "Nothing to write" }, { status: 400 });
      await salesforceApi(`/sobjects/Contact/${key}`, { method: "PATCH", body: fields });
      return Response.json({ ok: true, written: Object.keys(fields) });
    }

    if (!enrichConfigured()) return Response.json({ error: "LinkedIn enrichment is not set up yet: ask an admin to add ENRICH_LAYER_API_KEY.", notConfigured: true }, { status: 503 });

    if (action === "search") {
      const url = typeof body?.url === "string" ? body.url.trim() : "";
      const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "", position = typeof body?.position === "string" ? body.position.trim().slice(0, 80) : "";
      if (url && !linkedinUrl(url)) return Response.json({ error: "That is not a LinkedIn address" }, { status: 400 });
      if (!url && !name && !position) return Response.json({ error: "Give a name, a position or a LinkedIn address" }, { status: 400 });
      if (!url && !row.accountName) return Response.json({ error: "This chart has no account name to search in" }, { status: 422 });
      let companyDomain = "";
      if (isAccountId(row.accountId)) { try { companyDomain = domainOf((await query<{ Website: string | null }>(`SELECT Website FROM Account WHERE Id = '${row.accountId}'`))[0]?.Website); } catch { /* the search then goes by company name */ } }
      const nextToken = typeof body?.nextToken === "string" ? body.nextToken.slice(0, 500) : "";
      const { people: found, nextToken: more } = await searchPeople({ url, name, position, companyName: row.accountName, companyDomain, nextToken });
      const have = new Set(chart.nodes.map(n => linkedinUrl(n.linkedin).toLowerCase().replace(/\/+$/, "")).filter(Boolean));
      return Response.json({ people: found.map(p => ({ ...card(p), inChart: have.has(p.url.toLowerCase().replace(/\/+$/, "")) })), nextToken: more });
    }

    if (action === "check") {
      const accountName = row.accountName;
      let domain = "";
      if (isAccountId(row.accountId)) { try { domain = domainOf((await query<{ Website: string | null }>(`SELECT Website FROM Account WHERE Id = '${row.accountId}'`))[0]?.Website); } catch { /* no website: profile links are not looked for */ } }
      // People who already have a profile link first, then those without; the chart's own people only, never provisional-free guesses.
      const ordered = [...chart.nodes.filter(n => n.linkedin), ...chart.nodes.filter(n => !n.linkedin)].slice(0, MAX_CHECK);
      const results = await mapLimit(ordered, 4, async node => {
        const out: Suggestion[] = [];
        try {
          let profile: LiProfile | null = null;
          if (node.linkedin) profile = await fetchProfile(node.linkedin);
          else {
            const known = node.email ? await salesAiLinkedin(node.email) : "";
            profile = known ? await fetchProfile(known) : (domain ? await resolveProfile(node.name, domain, node.title) : null);
            if (profile?.url) out.push({ id: `${node.key}:url`, key: node.key, name: node.name, kind: "url", from: "", to: profile.url, detail: known ? "Profile link from Sales AI." : `Found on LinkedIn by name at ${domain}.`, linkedin: profile.url });
          }
          if (profile) out.push(...suggestFor(node, profile, accountName));
          return { suggestions: out, looked: true };
        } catch (error) {
          if (error instanceof EnrichNotConfiguredError) throw error;
          return { suggestions: out, looked: false, error: error instanceof Error ? error.message : "failed" };
        }
      });
      const errors = results.filter(r => "error" in r && r.error).map(r => (r as { error: string }).error);
      // A refused key, no credits or the rate limit would repeat for every person: report that once instead of "nothing found".
      if (errors.length && errors.length === results.length) return Response.json({ error: errors[0] }, { status: 502 });
      return Response.json({ suggestions: results.flatMap(r => r.suggestions), checked: results.filter(r => r.looked).length, total: chart.nodes.length, capped: chart.nodes.length > MAX_CHECK, noDomain: !domain, failed: errors.length });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Org chart LinkedIn failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: error instanceof Error ? error.message : "LinkedIn enrichment failed" }, { status: 502 });
  }
}

// The logo of an account, from Sales AI's export API. The plain `accounts` list has only id, name, industry and owner; asking for one
// account (`accounts?account_id=…`) also returns the enrichment record, whose `profile_pic_url` is the company's profile picture
// (its logo). Only the web address is kept. Returns "" when Sales AI is not set up, has nothing, or cannot be reached.
export type SalesAIAccountRecord = { enrich_json?: { profile_pic_url?: unknown } | null } | null | undefined;

// A usable logo address: a plain https link, not too long, no login in it.
export function logoFromAccount(record: SalesAIAccountRecord): string {
  const value = record?.enrich_json?.profile_pic_url;
  if (typeof value !== "string" || value.length > 500) return "";
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : ""; } catch { return ""; }
}

export async function fetchAccountLogo(accountId: string): Promise<string> {
  const base = process.env.SALES_AI_BASE_URL, key = process.env.SALES_AI_API_KEY;
  if (!base || !key || !/^[A-Za-z0-9]{15,18}$/.test(accountId)) return "";
  try {
    const url = new URL(`${base}${base.endsWith("/") ? "" : "/"}accounts`);
    url.searchParams.set("account_id", accountId); url.searchParams.set("limit", "1");
    const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return "";
    const body = await response.json() as { data?: SalesAIAccountRecord[] };
    return logoFromAccount(body.data?.[0]);
  } catch { return ""; }
}

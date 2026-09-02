// Thin HTTP client for Sales AI's export API — confirmed live on
// 2026-09-02: GET {SALES_AI_BASE_URL}/{entity}?...&limit&offset, bearer
// token auth, {status,count,data,pagination:{total,limit,offset,has_more}}
// response shape. No SDK exists for this, so this is hand-rolled against
// exactly what was observed, not a spec.
const PAGE_SIZE = 100;
// Safety cap, not a real limit — the rate limit itself is 100 requests per
// window (X-RateLimit-* headers on every response), so this just stops a
// pagination bug from silently looping forever and burning the whole
// window on one call.
const MAX_PAGES = 20;

export type SalesAIPage<T> = { data: T[]; pagination: { total: number; has_more: boolean } };

async function fetchPage<T>(baseUrl: string, apiKey: string, entity: string, params: Record<string, string>, offset: number): Promise<SalesAIPage<T>> {
  const url = new URL(`${baseUrl}${baseUrl.endsWith("/") ? "" : "/"}${entity}`);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`Sales AI request failed (${response.status}) for ${entity}`);
  return response.json() as Promise<SalesAIPage<T>>;
}

export async function fetchAllPages<T>(baseUrl: string, apiKey: string, entity: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage<T>(baseUrl, apiKey, entity, params, offset);
    results.push(...result.data);
    if (!result.pagination.has_more) break;
    offset += PAGE_SIZE;
  }
  return results;
}

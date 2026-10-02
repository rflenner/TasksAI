import { readFile } from "node:fs/promises";
import path from "node:path";
import { currentActor } from "../lib/session";

export const dynamic = "force-dynamic";

// Close Plan demo, linked from the sidebar. The prototype is a self-contained
// HTML page (prototype/close-plan-demo.html, fictional data only) served as
// its own document rather than in an iframe: X-Frame-Options DENY in
// next.config.ts blocks framing even from the same origin. Signed-in users
// only, same rule as every other page; the relative Location header avoids
// building an absolute URL from the internal host behind Render's proxy.
export async function GET() {
  const actor = await currentActor();
  if (!actor) return new Response(null, { status: 307, headers: { location: "/login?returnTo=/close-plans" } });
  const body = await readFile(path.join(process.cwd(), "prototype", "close-plan-demo.html"), "utf8");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="icon" href="/favicon.svg"><style>body{margin:0}</style></head><body>${body}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

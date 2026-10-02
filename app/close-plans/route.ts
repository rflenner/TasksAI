import { closePlanPageHtml } from "../lib/close-plan-page";
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
  return new Response(await closePlanPageHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

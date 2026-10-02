import { closePlanPageHtml } from "../../lib/close-plan-page";

export const dynamic = "force-dynamic";

// A customer contact's personal link to a close plan. No sign-in: the token in
// the path is the credential, checked by /api/close-plans/shared/:token when the
// page loads its data, so an unknown or expired link shows a message there.
// No indexing; the app-wide Referrer-Policy (strict-origin-when-cross-origin)
// already keeps the token in this path from leaking to other sites.
export async function GET() {
  return new Response(await closePlanPageHtml(), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}

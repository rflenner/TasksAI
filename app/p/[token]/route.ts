import { closePlanPageHtml } from "../../lib/close-plan-page";
import { resolvePlanLink } from "../../lib/close-plan-links";
import { appLinkOrigin, publicRequestOrigin } from "../../lib/request";

export const dynamic = "force-dynamic";

// A customer contact's personal link to a close plan. No sign-in: the token in
// the path is the credential, checked by /api/close-plans/shared/:token when the
// page loads its data, so an unknown or expired link shows a message there.
// No indexing; the app-wide Referrer-Policy (strict-origin-when-cross-origin)
// already keeps the token in this path from leaking to other sites.
//
// Two things make the link look right where it is pasted: the page title and link preview
// (the close plan's own name, with the iSEEit logo), and the address: once APP_URL is a custom
// domain (closeplan.iseeit.ai), a link opened on the old *.onrender.com address is sent on to it, so links
// that were emailed before the move keep working and end up on the nice address.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const canonical = canonicalOrigin();
  const here = publicRequestOrigin(request);
  if (canonical && here !== canonical && new URL(here).hostname.endsWith(".onrender.com")) {
    return new Response(null, { status: 308, headers: { location: `${canonical}/p/${encodeURIComponent(token)}`, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
  }
  let title: string | undefined;
  try {
    const found = await resolvePlanLink(token);
    const data = found ? found.row.data as { title?: unknown; account?: unknown } : null;
    const name = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : typeof data?.account === "string" ? data.account.trim() : "";
    if (name) title = name;
  } catch { /* a database hiccup only costs the title */ }
  return new Response(await closePlanPageHtml({ title, origin: appLinkOrigin(request) }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}

function canonicalOrigin() {
  try { return process.env.APP_URL ? new URL(process.env.APP_URL).origin : ""; } catch { return ""; }
}

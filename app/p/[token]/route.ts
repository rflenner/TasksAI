import { closePlanPageHtml } from "../../lib/close-plan-page";
import { resolvePlanLink } from "../../lib/close-plan-links";
import { customerBase, customerOrigin } from "../../lib/close-plan-urls";
import { appLinkOrigin, publicRequestOrigin } from "../../lib/request";

export const dynamic = "force-dynamic";

// A customer contact's personal link to a close plan. No sign-in: the token in
// the path is the credential, checked by /api/close-plans/shared/:token when the
// page loads its data, so an unknown or expired link shows a message there.
// No indexing; the app-wide Referrer-Policy (strict-origin-when-cross-origin)
// already keeps the token in this path from leaking to other sites.
//
// Two things make the link look right where it is pasted: the page title and link preview (the close plan's own name with the iSEEit
// logo), and the address. Once CLOSEPLAN_URL is set (https://closeplan.iseeit.ai), a link opened on any other address (tasks.flenner.at,
// *.onrender.com) is sent on to it, so links that were emailed before keep working and end up on the customer address. Without
// CLOSEPLAN_URL, only a link on a *.onrender.com address is sent on to APP_URL, as before. Nothing else on the site is redirected.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const here = publicRequestOrigin(request), customer = customerOrigin();
  const canonical = customer || appOrigin();
  const hostname = new URL(here).hostname;
  const redirect = canonical && here !== canonical && (customer ? !/^(localhost|127\.0\.0\.1)$/.test(hostname) : hostname.endsWith(".onrender.com"));
  if (redirect) {
    return new Response(null, { status: 308, headers: { location: `${canonical}/p/${encodeURIComponent(token)}`, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
  }
  let title: string | undefined;
  try {
    const found = await resolvePlanLink(token);
    const data = found ? found.row.data as { title?: unknown; account?: unknown } : null;
    const name = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : typeof data?.account === "string" ? data.account.trim() : "";
    if (name) title = name;
  } catch { /* a database hiccup only costs the title */ }
  return new Response(await closePlanPageHtml({ title, origin: customerBase(appLinkOrigin(request)) }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}

function appOrigin() {
  try { return process.env.APP_URL ? new URL(process.env.APP_URL).origin : ""; } catch { return ""; }
}

// The customer address (CLOSEPLAN_URL, e.g. https://closeplan.iseeit.ai) serves Close Plan for customers only:
// their personal links (/p/<token>), unsubscribe pages, the Close Plan API those pages call, and static files.
// Anything else opened on it (Task AI, the login, admin pages) is sent on to the same path on the main address
// (APP_URL), so customers never land in Task AI and colleagues end up where they work. Used by proxy.ts; nothing
// changes while CLOSEPLAN_URL is unset or equals APP_URL. Tested in tests/close-plan-host.test.ts.

const CUSTOMER_PATHS = [/^\/p\//, /^\/unsubscribe\//, /^\/api\/close-plans\//, /^\/_next\//, /^\/favicon\.(ico|svg)$/];
// Public files (logos, scripts, the PDF viewer) have a file extension in their last segment.
const STATIC_FILE = /\/[^/]+\.[a-z0-9]{2,5}$/i;

export function isCustomerPath(pathname: string): boolean {
  return CUSTOMER_PATHS.some(re => re.test(pathname)) || (!pathname.startsWith("/api/") && STATIC_FILE.test(pathname));
}

const originOf = (raw: string | undefined) => {
  try { const u = new URL((raw || "").trim()); return /^https?:$/.test(u.protocol) ? u.origin : ""; } catch { return ""; }
};

// Where to send a request that came in on `host`, or null to serve it here.
export function customerHostRedirect(input: { host: string; pathname: string; search: string; customerUrl?: string; appUrl?: string }): string | null {
  const customer = originOf(input.customerUrl), app = originOf(input.appUrl);
  if (!customer || !app || customer === app) return null;
  if (input.host.toLowerCase() !== new URL(customer).host) return null;
  if (isCustomerPath(input.pathname)) return null;
  return `${app}${input.pathname}${input.search}`;
}

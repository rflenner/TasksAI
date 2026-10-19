// The two addresses Close Plan builds links from.
//
//  - Internal (iSEEit people): `APP_URL`, the address Task AI itself uses ("Open the plan" in the notices to colleagues).
//  - Customer-facing: `CLOSEPLAN_URL` (https://closeplan.iseeit.ai), used for personal links (/p/<token>), invitation and reminder emails to
//    customers, unsubscribe links and the link preview. Without it, everything falls back to the internal address, so nothing changes until it is set.
//
// A `/p/<token>` link opened on any other address (tasks.flenner.at, *.onrender.com) is sent on to CLOSEPLAN_URL (app/p/[token]/route.ts),
// so links that were emailed earlier keep working and end up on the customer address. Nothing else is redirected.
const DEFAULT = "https://tasks-ai.onrender.com";
const clean = (v?: string | null) => (v || "").trim().replace(/\/+$/, "");

export const internalBase = (requestBase?: string) => clean(requestBase) || clean(process.env.APP_URL) || DEFAULT;
export const customerBase = (requestBase?: string) => customerOrigin() || internalBase(requestBase);

// The origin of CLOSEPLAN_URL, or "" when it is not set (or is not a valid address).
export function customerOrigin(): string {
  const raw = clean(process.env.CLOSEPLAN_URL); if (!raw) return "";
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) ? u.origin : ""; } catch { return ""; }
}

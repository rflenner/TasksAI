import { accountContacts } from "../../../lib/close-plan-sales-ai";
import { currentActor } from "../../../lib/session";

// Contacts of the account behind the opportunity picked in the Close Plan
// guide, duplicates merged. Same admin-only rule as the opportunity search.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin" && actor.role !== "area_admin") return Response.json({ error: "Live Sales AI search is available to admins" }, { status: 403 });
  const accountId = (new URL(request.url).searchParams.get("account_id") || "").trim();
  if (!/^[A-Za-z0-9]{6,40}$/.test(accountId)) return Response.json({ error: "account_id is required" }, { status: 400 });
  try {
    return Response.json({ contacts: await accountContacts(accountId) });
  } catch (error) {
    console.error("Close Plan contact lookup failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Sales AI is not reachable right now" }, { status: 502 });
  }
}

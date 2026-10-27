import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "../../db";
import { orgCharts, users } from "../../db/schema";
import { canViewOrgCharts } from "../lib/close-plan-store";
import { currentActor } from "../lib/session";
import OrgChartsClient from "./OrgChartsClient";

export const dynamic = "force-dynamic";

// The org charts copied from Salesforce (an account's or an opportunity's). Admins who can create Close Plans.
export default async function OrgChartsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/org-charts");
  if (!canViewOrgCharts(actor)) redirect("/");
  const rows = await getDb().select({ id: orgCharts.id, kind: orgCharts.kind, sfdcId: orgCharts.sfdcId, name: orgCharts.name, accountName: orgCharts.accountName, people: orgCharts.people, importedAt: orgCharts.importedAt, importedBy: users.name, editedAt: orgCharts.editedAt, logo: orgCharts.logo })
    .from(orgCharts).leftJoin(users, eq(users.id, orgCharts.importedBy)).orderBy(desc(orgCharts.importedAt));
  const charts = rows.map(r => ({ ...r, importedAt: r.importedAt.toISOString(), importedBy: r.importedBy || "", editedAt: r.editedAt ? r.editedAt.toISOString() : null }));
  return (
    <div className="max-w-[2000px] mx-auto px-3 py-4 sm:px-6 sm:py-6">
      <Link href="/" className="text-sm text-[#697181]">← Back to Task AI</Link>
      <OrgChartsClient initialCharts={charts as never} />
    </div>
  );
}

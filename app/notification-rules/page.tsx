import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import { desc } from "drizzle-orm";
import { getDb } from "../../db";
import { notificationOptouts } from "../../db/schema";
import { loadRules } from "../lib/close-plan-notify-rules";
import NotificationRulesClient from "./NotificationRulesClient";

export const dynamic = "force-dynamic";

// Who gets which Close Plan notification, and who asked not to be emailed. Site admins only.
export default async function NotificationRulesPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/notification-rules");
  if (actor.role !== "site_admin") redirect("/");
  const rules = await loadRules();
  const optouts = (await getDb().select().from(notificationOptouts).orderBy(desc(notificationOptouts.createdAt))).map(r => ({ email: r.email, source: r.source, reason: r.reason, createdAt: r.createdAt.toISOString() }));
  return (
    <div className="max-w-4xl mx-auto p-8">
      <Link href="/" className="text-sm text-[#697181]">← Back to Task AI</Link>
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76] mt-4">ADMIN</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-1 mb-1">Close Plan notifications</h1>
      <p className="text-[#697181] mb-6 max-w-3xl">Who gets which email or Slack message from Close Plans, and who asked not to be emailed. Customers are never emailed more often than the weekly cap.</p>
      <NotificationRulesClient initial={rules} initialOptouts={optouts} />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import CloseplanActivityClient from "./CloseplanActivityClient";

export const dynamic = "force-dynamic";

// Who logged in or opened a Close Plan, what they viewed and what they changed. Site admins only.
export default async function CloseplanActivityPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/close-plan-activity");
  if (actor.role !== "site_admin") redirect("/");
  return (
    <div className="max-w-6xl mx-auto p-8">
      <Link href="/" className="text-sm text-[#697181]">← Back to Task AI</Link>
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76] mt-4">ADMIN</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-1 mb-1">Close Plan activity</h1>
      <p className="text-[#697181] mb-6 max-w-3xl">Who signed in or opened a plan (the iSEEit team and customers on their personal link), what they looked at and what they changed. Only site admins can see this. Entries are kept for a year. Times are shown in your time zone.</p>
      <CloseplanActivityClient />
    </div>
  );
}

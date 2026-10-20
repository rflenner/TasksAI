import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import { loadRoles, loadRoleUsage } from "../lib/close-plan-roles";
import CloseplanRolesClient from "./CloseplanRolesClient";

export const dynamic = "force-dynamic";

// The roles people can have on a Close Plan (Executive sponsor, Account lead, …). Site admins only.
export default async function CloseplanRolesPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/close-plan-roles");
  if (actor.role !== "site_admin") redirect("/");
  const [roles, usage] = await Promise.all([loadRoles(), loadRoleUsage()]);
  return (
    <div className="max-w-4xl mx-auto p-8">
      <Link href="/" className="text-sm text-[#697181]">← Back to Task AI</Link>
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76] mt-4">ADMIN</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-1 mb-1">Close Plan roles</h1>
      <p className="text-[#697181] mb-6 max-w-3xl">The roles people can be given on a plan, for the customer and for iSEEit. Renaming a role changes it for everyone who has it, in every plan. The roles marked “built in” are used by the new-plan wizard and templates: they can be renamed but not removed.</p>
      <CloseplanRolesClient initialRoles={roles} initialUsage={usage} />
    </div>
  );
}

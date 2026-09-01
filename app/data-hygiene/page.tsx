import { redirect } from "next/navigation";
import { dimensionHygieneSummary } from "../lib/data-hygiene";
import { currentActor } from "../lib/session";
import DataHygieneClient from "./DataHygieneClient";
export const dynamic = "force-dynamic";
export default async function DataHygienePage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/data-hygiene");
  if (actor.role !== "site_admin") redirect("/");
  return <DataHygieneClient initialDimensions={await dimensionHygieneSummary()} />;
}

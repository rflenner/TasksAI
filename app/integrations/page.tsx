import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import IntegrationsClient from "./IntegrationsClient";
export const dynamic = "force-dynamic";
export default async function IntegrationsPage() { const actor = await currentActor(); if (!actor) redirect("/login?returnTo=/integrations"); if (actor.role !== "site_admin") redirect("/"); return <IntegrationsClient />; }

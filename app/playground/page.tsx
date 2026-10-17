import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import PlaygroundClient from "./PlaygroundClient";
export const dynamic = "force-dynamic";
export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<{ opportunityId?: string }> }) { const { opportunityId } = await searchParams; const actor = await currentActor(); if (!actor) redirect("/login?returnTo=/playground"); if (actor.role !== "site_admin") redirect("/"); return <PlaygroundClient initialOpportunityId={(opportunityId || "").trim().slice(0, 18)} />; }

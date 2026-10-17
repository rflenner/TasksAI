import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import PlaygroundClient from "./PlaygroundClient";
export const dynamic = "force-dynamic";
export default async function PlaygroundPage() { const actor = await currentActor(); if (!actor) redirect("/login?returnTo=/playground"); if (actor.role !== "site_admin") redirect("/"); return <PlaygroundClient />; }

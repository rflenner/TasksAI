import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import VoiceTestClient from "./VoiceTestClient";
export const dynamic = "force-dynamic";
export default async function VoiceTestPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/voice-test");
  return <VoiceTestClient />;
}

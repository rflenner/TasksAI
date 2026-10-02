import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import VoiceLiveClient from "./VoiceLiveClient";
export const dynamic = "force-dynamic";
export default async function VoiceTestRealtimePage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/voice-test-realtime");
  return <VoiceLiveClient />;
}

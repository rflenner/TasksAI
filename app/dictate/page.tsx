import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import DictateClient from "./DictateClient";
export const dynamic = "force-dynamic";
export default async function DictatePage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/dictate");
  return <DictateClient />;
}

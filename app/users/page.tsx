import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import UsersClient from "./UsersClient";
export const dynamic="force-dynamic";
export default async function UsersPage(){const actor=await currentActor();if(!actor)redirect("/login?returnTo=/users");if(!actor.canInvite)redirect("/");return <UsersClient/>}

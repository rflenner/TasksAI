import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import EmailPreviewClient from "./EmailPreviewClient";
export const dynamic="force-dynamic";
export default async function EmailPreviewPage({searchParams}:{searchParams:Promise<{kind?:string}>}){const {kind}=await searchParams;const actor=await currentActor();if(!actor)redirect("/login?returnTo=/email-preview");if(actor.role!=="site_admin")redirect("/");return <EmailPreviewClient kind={kind||""}/>}

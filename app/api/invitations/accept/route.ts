import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companies, dimensionValues, tasks, users } from "../../../../db/schema";
import { renderPendingTasksEmail, sendWithResend } from "../../../lib/email";
import { validateInvitationProfile } from "../../../lib/invitations";
import { personalTaskDigest } from "../../../lib/pending-tasks";
import { publicRequestOrigin, requireSameOrigin } from "../../../lib/request";
import { sha256 } from "../../../lib/security";
import { createSession, setSessionCookie } from "../../../lib/session";

async function invitation(token:string){const[row]=await getDb().select().from(users).where(and(eq(users.inviteTokenHash,sha256(token)),eq(users.status,"pending"),gt(users.inviteExpiresAt,new Date()))).limit(1);return row}
export async function GET(request:Request){const token=new URL(request.url).searchParams.get("token");if(!token)return Response.json({error:"Missing invitation token"},{status:400});const user=await invitation(token);if(!user)return Response.json({error:"This invitation is invalid, expired, or already used"},{status:400});return Response.json({invitation:{email:user.email,name:user.name,role:user.role,channel:user.inviteChannel,expiresAt:user.inviteExpiresAt}})}
export async function POST(request:Request){
 const invalid=requireSameOrigin(request);if(invalid)return invalid;
 const input=await request.json() as Record<string,string>;if(!input.token)return Response.json({error:"Missing invitation token"},{status:400});
 const user=await invitation(input.token);if(!user)return Response.json({error:"This invitation is invalid, expired, or already used"},{status:400});
 const profile=validateInvitationProfile(input,user.email);if("error"in profile)return Response.json({error:profile.error},{status:400});
 const{name,firstName,lastName,company}=profile.value,normalizedName=company.toLocaleLowerCase(),oldName=user.name;
 const result=await getDb().transaction(async tx=>{
  const[companyRow]=await tx.insert(companies).values({name:company,normalizedName}).onConflictDoUpdate({target:companies.normalizedName,set:{name:company}}).returning();
  const[nowUser]=await tx.update(users).set({firstName,lastName,name,companyId:companyRow.id,emailVerifiedAt:new Date(),status:"active",inviteTokenHash:null,acceptedAt:new Date()}).where(and(eq(users.id,user.id),eq(users.inviteTokenHash,sha256(input.token)))).returning();
  if(!nowUser)throw new Error("Invitation was already used");
  if(oldName!=="Invited user"&&oldName!==name){for(const task of await tx.select().from(tasks)){const owner=task.owner===oldName?name:task.owner,collaborators=task.collaborators.map(value=>value===oldName?name:value),recipients=task.recipients.map(value=>value===oldName?name:value);if(owner!==task.owner||collaborators.some((value,index)=>value!==task.collaborators[index])||recipients.some((value,index)=>value!==task.recipients[index]))await tx.update(tasks).set({owner,collaborators,recipients}).where(eq(tasks.id,task.id))}}
  await tx.insert(dimensionValues).values({type:"person",value:name}).onConflictDoNothing();return{user:nowUser,company:companyRow};
 });
 const session=await createSession(result.user.id);await setSessionCookie(session.value,session.expiresAt);
 // Best-effort welcome email if any existing tasks already name this person
 // (as owner, coworker, or recipient) — matched by their now-confirmed name,
 // same rule used everywhere else. Never blocks acceptance if it fails.
 let tasksNotified=0;
 try{
  const{myTasks,delegatedTasks,recentlyClosed}=await personalTaskDigest({id:result.user.id,name,role:result.user.role});
  const total=myTasks.length+delegatedTasks.length;
  if(total||recentlyClosed.length){
   const appUrl=publicRequestOrigin(request);
   const message=renderPendingTasksEmail({firstName:name,appUrl,myTasks,delegatedTasks,recentlyClosed});
   await sendWithResend({...message,to:result.user.email,idempotencyKey:`welcome-${result.user.id}`});
   tasksNotified=total;
  }
 }catch(error){console.error(`Welcome-tasks email failed for user ${result.user.id}:`,error instanceof Error?error.message:error)}
 return Response.json({user:{id:result.user.id,email:result.user.email,name,companyName:result.company.name,emailVerifiedAt:result.user.emailVerifiedAt},tasksNotified});
}

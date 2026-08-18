import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tasks, users } from "../../../../db/schema";
import { renderPendingTasksEmail, sendWithResend } from "../../../lib/email";
import { canSeeTask } from "../../../lib/permissions";
import { publicRequestOrigin, requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";
export async function POST(request:Request){
 const invalid=requireSameOrigin(request);if(invalid)return invalid;
 const actor=await currentActor();if(actor?.role!=="site_admin")return Response.json({error:"Site Admin access required"},{status:403});
 const input=await request.json() as {userId?:number};
 if(!input.userId)return Response.json({error:"User id required"},{status:400});
 const[target]=await getDb().select().from(users).where(eq(users.id,input.userId)).limit(1);
 if(!target||target.status!=="active")return Response.json({error:"User not found or not active"},{status:404});
 const targetActor={id:target.id,email:target.email,name:target.name,role:target.role,status:target.status,canInvite:target.canInvite,projects:target.projects,meetings:target.meetings,topics:target.topics};
 const all=await getDb().select().from(tasks);
 const today=new Date().toISOString().slice(0,10);
 const pending=all
  .filter(task=>task.status!=="Closed"&&canSeeTask(task,targetActor))
  .map(task=>({
   subject:task.subject,
   project:task.project||undefined,
   meeting:task.recurringMeeting||undefined,
   due:task.due||undefined,
   overdue:Boolean(task.due)&&task.due<today,
   role:(task.owner===target.name?"Owner":task.collaborators.includes(target.name)?"Coworker":task.recipients.includes(target.name)?"Recipient":undefined) as "Owner"|"Coworker"|"Recipient"|undefined,
  }))
  .sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999"));
 if(!pending.length)return Response.json({error:`${target.name} has no pending tasks right now`},{status:400});
 const appUrl=publicRequestOrigin(request);
 const message=renderPendingTasksEmail({firstName:target.name,appUrl,tasks:pending.slice(0,10),totalPending:pending.length});
 try{
  const delivery=await sendWithResend({...message,to:target.email,idempotencyKey:`pending-${target.id}-${Date.now()}`});
  return Response.json({sent:delivery.sent,reason:"reason" in delivery?delivery.reason:undefined,count:pending.length});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"Email delivery failed"},{status:502});
 }
}

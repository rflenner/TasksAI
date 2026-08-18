import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { renderPendingTasksEmail, sendWithResend } from "../../../lib/email";
import { personalPendingTasks } from "../../../lib/pending-tasks";
import { publicRequestOrigin, requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";
export async function POST(request:Request){
 const invalid=requireSameOrigin(request);if(invalid)return invalid;
 const actor=await currentActor();if(actor?.role!=="site_admin")return Response.json({error:"Site Admin access required"},{status:403});
 const input=await request.json() as {userId?:number};
 if(!input.userId)return Response.json({error:"User id required"},{status:400});
 const[target]=await getDb().select().from(users).where(eq(users.id,input.userId)).limit(1);
 if(!target||target.status!=="active")return Response.json({error:"User not found or not active"},{status:404});
 const{tasks:pending,total}=await personalPendingTasks(target);
 if(!pending.length)return Response.json({error:`${target.name} has no pending tasks right now`},{status:400});
 const appUrl=publicRequestOrigin(request);
 const message=renderPendingTasksEmail({firstName:target.name,appUrl,tasks:pending.slice(0,10),totalPending:total});
 try{
  const delivery=await sendWithResend({...message,to:target.email,idempotencyKey:`pending-${target.id}-${Date.now()}`});
  return Response.json({sent:delivery.sent,reason:"reason" in delivery?delivery.reason:undefined,count:total});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"Email delivery failed"},{status:502});
 }
}

import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tasks } from "../../../../db/schema";
import { canSeeTask } from "../../../lib/permissions";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";
import { recordView } from "../../../lib/task-activity";
export async function POST(request:Request){
 const invalid=requireSameOrigin(request);if(invalid)return invalid;
 const actor=await currentActor();if(!actor)return Response.json({error:"Sign in required"},{status:401});
 const input=await request.json() as {taskId?:number};
 if(!input.taskId)return Response.json({error:"Task id required"},{status:400});
 const[task]=await getDb().select().from(tasks).where(eq(tasks.id,input.taskId)).limit(1);
 if(!task||!canSeeTask(task,actor))return Response.json({error:"Task not found"},{status:404});
 await recordView(task.id,actor.name);
 return Response.json({ok:true});
}

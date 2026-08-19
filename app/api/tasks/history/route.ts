import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tasks } from "../../../../db/schema";
import { canSeeTask } from "../../../lib/permissions";
import { currentActor } from "../../../lib/session";
import { taskHistory } from "../../../lib/task-activity";
export async function GET(request:Request){
 const actor=await currentActor();if(!actor)return Response.json({error:"Sign in required"},{status:401});
 const taskId=Number(new URL(request.url).searchParams.get("taskId"));
 if(!taskId)return Response.json({error:"Task id required"},{status:400});
 const[task]=await getDb().select().from(tasks).where(eq(tasks.id,taskId)).limit(1);
 if(!task||!canSeeTask(task,actor))return Response.json({error:"Task not found"},{status:404});
 const history=await taskHistory(task.id,task.created,task.createdBy);
 return Response.json({history});
}

import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dimensionValues, tasks, users } from "../../../db/schema";
import { canCreateTask, canSeeTask, canWriteTask } from "../../lib/permissions";
import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";
import { describeChanges, recordActivity } from "../../lib/task-activity";
type StoredTask=typeof tasks.$inferSelect; type Input=Partial<StoredTask>&{recurring_meeting?:string}; type DimensionType="project"|"meeting"|"topic"|"person";
const cleanList=(value:unknown)=>Array.isArray(value)?value.map(String).map(x=>x.trim()).filter(Boolean):[];
// externalSource/externalId only ever come through when a caller explicitly
// sets them (a future Sales AI sync, say) — an ordinary browser edit never
// sends these fields, so they stay null and nothing changes for the normal
// create/edit path. See db/schema.ts for why both being null is the default,
// expected case.
function values(input:Input){return{subject:String(input.subject||"").trim(),description:String(input.description||""),owner:String(input.owner||"").trim(),collaborators:cleanList(input.collaborators),recipients:cleanList(input.recipients),due:String(input.due||""),source:String(input.source||""),topic:String(input.topic||""),project:String(input.project||""),recurringMeeting:String(input.recurringMeeting??input.recurring_meeting??""),status:String(input.status||"Open"),created:String(input.created||new Date().toISOString()),updates:Array.isArray(input.updates)?input.updates:[],externalSource:input.externalSource?String(input.externalSource):null,externalId:input.externalId?String(input.externalId):null,accountId:input.accountId?String(input.accountId):null,accountName:input.accountName?String(input.accountName):null,opportunityId:input.opportunityId?String(input.opportunityId):null,opportunityName:input.opportunityName?String(input.opportunityName):null,citationUser:input.citationUser?String(input.citationUser):null,citationQuote:input.citationQuote?String(input.citationQuote):null,meetingId:input.meetingId?String(input.meetingId):null}}
function entries(task:Input):Array<[DimensionType,string]>{return [["project",task.project],["meeting",task.recurringMeeting],["topic",task.topic],["person",task.owner],...cleanList(task.collaborators).map(x=>["person",x]),...cleanList(task.recipients).map(x=>["person",x])].map(([t,v])=>[t as DimensionType,String(v||"").trim()]).filter((x):x is [DimensionType,string]=>Boolean(x[1]))}
async function register(task:Input){for(const[type,value]of entries(task))await getDb().insert(dimensionValues).values({type,value}).onConflictDoNothing()}
async function dimensions(){const rows=await getDb().select().from(dimensionValues).orderBy(dimensionValues.value);return{project:rows.filter(x=>x.type==="project").map(x=>x.value),meeting:rows.filter(x=>x.type==="meeting").map(x=>x.value),topic:rows.filter(x=>x.type==="topic").map(x=>x.value),person:rows.filter(x=>x.type==="person").map(x=>x.value)}}
export async function GET(){const actor=await currentActor();if(!actor)return Response.json({error:"Sign in required"},{status:401});const all=await getDb().select().from(tasks).orderBy(desc(tasks.id));const visible=all.filter(task=>canSeeTask(task,actor));const scoped={project:[...new Set(visible.map(x=>x.project))],meeting:[...new Set(visible.map(x=>x.recurringMeeting))],topic:[...new Set(visible.map(x=>x.topic))],person:[...new Set(visible.flatMap(x=>[x.owner,...x.collaborators,...x.recipients]))]};
 // Every name that already has a users row (pending or active — a second
 // invite for someone mid-invitation should go through Resend invitation,
 // not this flow) — lets the client flag a task's owner/coworker/recipient
 // as "not yet on Task AI" and offer to invite them, without a whole
 // separate endpoint just for that.
 const registeredPeople=(await getDb().select({name:users.name}).from(users)).map(row=>row.name);
 return Response.json({tasks:visible,dimensions:actor.role==="site_admin"?await dimensions():scoped,registeredPeople,actor:{name:actor.name,email:actor.email,role:actor.role,canWrite:actor.role!=="readonly",canInvite:actor.canInvite}})}
export async function POST(request:Request){
 const invalid=requireSameOrigin(request);if(invalid)return invalid;
 const actor=await currentActor();if(!actor)return Response.json({error:"Sign in required"},{status:401});
 const input=values(await request.json());
 if(!canCreateTask(input,actor))return Response.json({error:"You cannot create this task"},{status:403});
 if(!input.subject||!input.owner)return Response.json({error:"Subject and owner are required"},{status:400});
 let task;
 try{[task]=await getDb().insert(tasks).values({...input,createdBy:actor.name,closedAt:input.status==="Closed"?new Date():null}).returning()}
 catch(error){
  // 23505 = unique_violation — only reachable via tasks_external_unique,
  // the only unique constraint values() input can hit (subject/owner etc.
  // have no uniqueness requirement). A normal browser create never sets
  // externalId, so this only ever fires for a future sync retrying an
  // item it's already imported — a clean, expected outcome, not a crash.
  if(input.externalId&&error&&typeof error==="object"&&"code" in error&&error.code==="23505")return Response.json({error:"A task from this external item already exists",code:"external_duplicate"},{status:409});
  throw error;
 }
 await register(task);
 return Response.json({task,dimensions:await dimensions()},{status:201});
}
// closedAt tracks the most recent Open/In progress → Closed transition:
// newly closed gets a fresh timestamp, already-closed keeps its original one
// (editing another field on a closed task shouldn't bump its close date),
// reopening clears it. Powers the digest's "Recently closed" section.
export async function PATCH(request:Request){const invalid=requireSameOrigin(request);if(invalid)return invalid;const actor=await currentActor();if(!actor)return Response.json({error:"Sign in required"},{status:401});const body=await request.json() as Input;if(!body.id)return Response.json({error:"Task id is required"},{status:400});const[existing]=await getDb().select().from(tasks).where(eq(tasks.id,body.id)).limit(1);const next={...values(body),id:body.id};if(!existing||!canWriteTask(existing,actor)||!canWriteTask(next,actor))return Response.json({error:"You cannot change this task"},{status:403});const closedAt=next.status!=="Closed"?null:existing.status==="Closed"?existing.closedAt:new Date();const[task]=await getDb().update(tasks).set({...values(body),closedAt}).where(eq(tasks.id,body.id)).returning();await register(task);await recordActivity(task.id,actor.name,describeChanges(existing,task));return Response.json({task,dimensions:await dimensions()})}
// Site Admin only, deliberately stricter than canWriteTask (which an area
// admin also passes) — closing a bad task is reversible and available to
// whoever could already edit it, deleting it outright isn't, so it stays
// behind the one role that can already see and touch everything. Cascades
// to task_activity/task_views via their own onDelete:"cascade" FKs (see
// db/schema.ts) — nothing left orphaned, nothing extra to clean up here.
export async function DELETE(request:Request){const invalid=requireSameOrigin(request);if(invalid)return invalid;const actor=await currentActor();if(!actor)return Response.json({error:"Sign in required"},{status:401});if(actor.role!=="site_admin")return Response.json({error:"Site Admin access required"},{status:403});const body=await request.json() as{id?:number};if(!body.id)return Response.json({error:"Task id is required"},{status:400});const[deleted]=await getDb().delete(tasks).where(eq(tasks.id,body.id)).returning();if(!deleted)return Response.json({error:"Task not found"},{status:404});return Response.json({ok:true})}

import { env } from "cloudflare:workers";

type StoredTask = Record<string, unknown> & { id?: number };
type DimensionType = "project" | "meeting" | "topic" | "person";
type Dimensions = Record<DimensionType, string[]>;
const columns = ["subject","description","owner","collaborators","recipients","due","source","topic","project","recurring_meeting","status","created","updates"] as const;
const jsonColumns = new Set(["collaborators", "recipients", "updates"]);

async function ensureTables() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL,
      collaborators TEXT NOT NULL DEFAULT '[]', recipients TEXT NOT NULL DEFAULT '[]', due TEXT NOT NULL, source TEXT NOT NULL,
      topic TEXT NOT NULL, project TEXT NOT NULL, recurring_meeting TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Open', created TEXT NOT NULL, updates TEXT NOT NULL DEFAULT '[]'
    )`),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS dimension_values (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, value TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS dimension_values_type_value_unique ON dimension_values(type, value)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', can_invite INTEGER NOT NULL DEFAULT 0, projects TEXT NOT NULL DEFAULT '[]', meetings TEXT NOT NULL DEFAULT '[]', topics TEXT NOT NULL DEFAULT '[]', invite_token_hash TEXT, invited_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)"),
    env.DB.prepare("INSERT OR IGNORE INTO users (email,name,role,status,can_invite) VALUES ('rizan@local.test','Rizan Flenner','site_admin','active',1)"),
    env.DB.prepare("INSERT OR IGNORE INTO users (email,name,role,status,can_invite) VALUES ('rizan@flenner.at','Rizan Flenner','site_admin','active',1)"),
  ]);
  await env.DB.prepare("INSERT OR IGNORE INTO dimension_values (type, value) VALUES ('meeting', 'Marketing Coordination')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO dimension_values (type, value) SELECT 'person', name FROM users WHERE status != 'revoked' AND trim(name) != ''").run();
}

type Actor={email:string;name:string;role:string;status:string;projects:string;meetings:string;topics:string};
const parseList=(value:unknown):string[]=>{try{return JSON.parse(String(value||"[]"))}catch{return[]}};
function cookieValue(request:Request,name:string){const item=request.headers.get("cookie")?.split(";").map(value=>value.trim()).find(value=>value.startsWith(`${name}=`));return item?decodeURIComponent(item.slice(name.length+1)):null}
async function getActor(request:Request){const url=new URL(request.url),local=url.hostname==="localhost"||url.hostname==="127.0.0.1";const email=(local?url.searchParams.get("as")||request.headers.get("x-act-user"):null)||cookieValue(request,"act_user")||request.headers.get("oai-authenticated-user-email")||(local?"rizan@local.test":null);if(!email)return null;return env.DB.prepare("SELECT email,name,role,status,projects,meetings,topics FROM users WHERE lower(email)=lower(?) AND status='active'").bind(email).first<Actor>();}
function relationship(task:StoredTask,actor:Actor){const collaborators=Array.isArray(task.collaborators)?task.collaborators:parseList(task.collaborators),recipients=Array.isArray(task.recipients)?task.recipients:parseList(task.recipients);if(actor.role==="readonly")return recipients.includes(actor.name);return task.owner===actor.name||collaborators.includes(actor.name)||recipients.includes(actor.name)}
function inScope(task:StoredTask,actor:Actor){const projects=parseList(actor.projects),meetings=parseList(actor.meetings),topics=parseList(actor.topics);return (!projects.length||projects.includes(String(task.project)))&&(!meetings.length||meetings.includes(String(task.recurringMeeting??task.recurring_meeting)))&&(!topics.length||topics.includes(String(task.topic)))}
function hasExplicitScope(actor:Actor){return parseList(actor.projects).length>0||parseList(actor.meetings).length>0||parseList(actor.topics).length>0}
function canSee(task:StoredTask,actor:Actor){if(actor.role==="site_admin")return true;if(actor.role==="area_admin")return inScope(task,actor);if(actor.role==="readonly")return relationship(task,actor)&&inScope(task,actor);return relationship(task,actor)||hasExplicitScope(actor)&&inScope(task,actor)}
function canWrite(task:StoredTask,actor:Actor){return actor.role!=="readonly"&&canSee(task,actor)}

function fromRow(row: Record<string, unknown>) { const { recurring_meeting, ...rest } = row; return { ...rest, recurringMeeting: recurring_meeting, collaborators: JSON.parse(String(row.collaborators || "[]")), recipients: JSON.parse(String(row.recipients || "[]")), updates: JSON.parse(String(row.updates || "[]")) }; }
function values(task: StoredTask) { return columns.map(column => { const key = column === "recurring_meeting" ? "recurringMeeting" : column; const value = task[key]; return jsonColumns.has(column) ? JSON.stringify(value ?? []) : value ?? ""; }); }
function dimensionEntries(task: StoredTask): Array<[DimensionType, string]> {
  const list = (value: unknown) => Array.isArray(value) ? value : [];
  const entries: Array<[DimensionType, unknown]> = [["project", task.project], ["meeting", task.recurringMeeting], ["topic", task.topic], ["person", task.owner], ...list(task.collaborators).map(value => ["person", value] as [DimensionType, unknown]), ...list(task.recipients).map(value => ["person", value] as [DimensionType, unknown])];
  return entries.map(([type, value]) => [type, String(value || "").trim()]).filter((entry): entry is [DimensionType, string] => Boolean(entry[1]));
}
async function registerDimensions(tasks: StoredTask[]) { const entries = tasks.flatMap(dimensionEntries); if (entries.length) await env.DB.batch(entries.map(([type, value]) => env.DB.prepare("INSERT OR IGNORE INTO dimension_values (type, value) VALUES (?, ?)").bind(type, value))); }
async function getDimensions(): Promise<Dimensions> { const result = await env.DB.prepare("SELECT type, value FROM dimension_values ORDER BY value COLLATE NOCASE").all(); const dimensions: Dimensions = { project: [], meeting: [], topic: [], person: [] }; for (const row of result.results as Array<{type: DimensionType; value: string}>) if (dimensions[row.type]) dimensions[row.type].push(row.value); return dimensions; }
async function migrateLegacyUpdateTimes(rows: Record<string, unknown>[]) {
  const statements = rows.flatMap(row => {
    const updates = JSON.parse(String(row.updates || "[]")) as Array<{text: string; at: string}>;
    if (!updates.some(update => update.at === "Just now")) return [];
    const migrated = updates.map(update => update.at === "Just now" ? { ...update, at: new Date().toISOString() } : update);
    row.updates = JSON.stringify(migrated);
    return [env.DB.prepare("UPDATE tasks SET updates = ? WHERE id = ?").bind(row.updates, row.id)];
  });
  if (statements.length) await env.DB.batch(statements);
}

export async function GET(request:Request) { await ensureTables(); const actor=await getActor(request);if(!actor)return Response.json({error:"Access is inactive or has not been invited"},{status:403});const result = await env.DB.prepare("SELECT * FROM tasks ORDER BY id DESC").all(); const rows = result.results as Record<string, unknown>[]; await migrateLegacyUpdateTimes(rows); const allTasks = rows.map(row => fromRow(row)); await registerDimensions(allTasks);const tasks=allTasks.filter(task=>canSee(task,actor));const dimensions:Dimensions={project:[...new Set(tasks.map(task=>String(task.project)))],meeting:[...new Set(tasks.map(task=>String(task.recurringMeeting)))],topic:[...new Set(tasks.map(task=>String(task.topic)))],person:[...new Set(tasks.flatMap(task=>[String(task.owner),...(task.collaborators as string[]),...(task.recipients as string[])]))]}; return Response.json({ tasks, dimensions:actor.role==="site_admin"?await getDimensions():dimensions,actor:{name:actor.name,email:actor.email,role:actor.role,canWrite:actor.role!=="readonly"} }); }
export async function POST(request: Request) { await ensureTables();const actor=await getActor(request);if(!actor)return Response.json({error:"Access denied"},{status:403}); const task = await request.json() as StoredTask;if(actor.role==="readonly"||!inScope(task,actor)||actor.role==="collaborator"&&!hasExplicitScope(actor)&&!relationship(task,actor))return Response.json({error:"You cannot create this task"},{status:403}); if (!String(task.subject || "").trim() || !String(task.owner || "").trim()) return Response.json({ error: "Subject and owner are required" }, { status: 400 }); const result = await env.DB.prepare(`INSERT INTO tasks (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...values(task)).run(); await registerDimensions([task]); const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(result.meta.last_row_id).first(); return Response.json({ task: fromRow(row as Record<string, unknown>), dimensions: await getDimensions() }, { status: 201 }); }
export async function PATCH(request: Request) { await ensureTables();const actor=await getActor(request);if(!actor)return Response.json({error:"Access denied"},{status:403}); const task = await request.json() as StoredTask; if (!task.id) return Response.json({ error: "Task id is required" }, { status: 400 });const existing=await env.DB.prepare("SELECT * FROM tasks WHERE id=?").bind(task.id).first<Record<string,unknown>>();if(!existing||!canWrite(fromRow(existing),actor)||!canWrite(task,actor))return Response.json({error:"You cannot change this task"},{status:403}); await env.DB.prepare(`UPDATE tasks SET ${columns.map(column => `${column} = ?`).join(",")} WHERE id = ?`).bind(...values(task), task.id).run(); await registerDimensions([task]); const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(task.id).first(); return Response.json({ task: fromRow(row as Record<string, unknown>), dimensions: await getDimensions() }); }

export type Role = "site_admin" | "area_admin" | "collaborator" | "readonly";
export type Actor = { id?: number; email: string; name: string; role: Role; status: string; canInvite?: boolean; projects: string[]; meetings: string[]; topics: string[] };
export type TaskScope = { owner?: unknown; collaborators?: unknown; recipients?: unknown; project?: unknown; recurringMeeting?: unknown; recurring_meeting?: unknown; topic?: unknown };
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
export function relationship(task: TaskScope, actor: Actor) { const collaborators=list(task.collaborators),recipients=list(task.recipients); return actor.role === "readonly" ? recipients.includes(actor.name) : task.owner === actor.name || collaborators.includes(actor.name) || recipients.includes(actor.name); }
export function inScope(task: TaskScope, actor: Actor) { return (!actor.projects.length || actor.projects.includes(String(task.project))) && (!actor.meetings.length || actor.meetings.includes(String(task.recurringMeeting ?? task.recurring_meeting))) && (!actor.topics.length || actor.topics.includes(String(task.topic))); }
export function hasExplicitScope(actor: Actor) { return actor.projects.length > 0 || actor.meetings.length > 0 || actor.topics.length > 0; }
// area_admin used to be gated on inScope() alone — meaning an area admin
// who is literally the owner/collaborator/recipient of a task couldn't
// see their OWN task once it fell outside their configured project/
// meeting/topic scope (e.g. a Sales-AI-synced task in an area they
// don't administer). Confirmed live 2026-09-15: Xenofon Kanarios (an
// area_admin) owned 30 open tasks but his own "My tasks" showed only 2
// — exactly the ones inside his configured scope — while a site_admin
// looking at his People page (unrestricted canSeeTask) saw all 30.
// Every other role already factors relationship() in (collaborator via
// `relationship || ...`, readonly via `relationship && ...`) — area_admin
// was the one place it was missing entirely. Owning/collaborating-on/
// receiving a task should always be enough to see it, on top of
// whatever the admin's scope additionally grants — same shape
// collaborator already has, just without collaborator's extra
// hasExplicitScope gate, since an area_admin's scope arrays being empty
// already means "no restriction" via inScope() itself.
export function canSeeTask(task: TaskScope, actor: Actor) { if (actor.role === "site_admin") return true; if (actor.role === "area_admin") return relationship(task, actor) || inScope(task, actor); if (actor.role === "readonly") return relationship(task, actor) && inScope(task, actor); return relationship(task, actor) || hasExplicitScope(actor) && inScope(task, actor); }
export function canCreateTask(task: TaskScope, actor: Actor) { return actor.role !== "readonly" && inScope(task, actor) && !(actor.role === "collaborator" && !hasExplicitScope(actor) && !relationship(task, actor)); }
export function canWriteTask(task: TaskScope, actor: Actor) { return actor.role !== "readonly" && canSeeTask(task, actor); }
export function mayManageRole(actor: Actor | null, targetRole: Role) { return Boolean(actor && (actor.role === "site_admin" || actor.role === "area_admin" && actor.canInvite && targetRole !== "site_admin" && targetRole !== "area_admin")); }

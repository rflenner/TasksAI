// Close Plan shared storage (step A): access rules and input checks for the
// plan documents in close_plan_documents. Pure and DB-free so the rules are
// unit-tested (tests/close-plan-store.test.ts); the routes in
// app/api/close-plans/store do the reading and writing.
import type { Role } from "./permissions";

export type StoreActor = { id?: number; email: string; role: Role };
export type PlanPerson = { id?: unknown; side?: unknown; email?: unknown };
export type PlanData = { id?: unknown; title?: unknown; account?: unknown; people?: unknown; planOwners?: { seller?: unknown } };

export const MAX_PLAN_BYTES = 2_000_000;
const lower = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";

// Emails of the plan's iSEEit (seller-side) members: the people who see the plan
// in Task AI. Customer contacts never do; they open the plan through a personal
// link instead (app/lib/close-plan-links.ts).
export function memberEmails(data: PlanData): string[] {
  const people = Array.isArray(data.people) ? data.people as PlanPerson[] : [];
  return [...new Set(people.filter(p => p && p.side === "seller").map(p => lower(p.email)).filter(Boolean))].sort();
}

// The iSEEit plan owner's email, or "" when it can't be resolved.
export function sellerOwnerEmail(data: PlanData): string {
  const people = Array.isArray(data.people) ? data.people as PlanPerson[] : [];
  const owner = people.find(p => p && p.id === data.planOwners?.seller);
  return owner ? lower(owner.email) : "";
}

// Who may open (and edit) a stored plan: Site Admins, its creator, and its iSEEit members.
export function canAccessPlan(actor: StoreActor, row: { memberEmails: string[]; createdBy: number | null }): boolean {
  if (actor.role === "site_admin") return true;
  if (actor.id != null && row.createdBy === actor.id) return true;
  return row.memberEmails.includes(lower(actor.email));
}

// New plans: admins only, the same people who can search Sales AI in the guide.
export const canCreatePlan = (actor: StoreActor) => actor.role === "site_admin" || actor.role === "area_admin";

// Personal links for customer contacts: the iSEEit plan owner or a Site Admin.
export function canManagePlanLinks(actor: StoreActor, data: PlanData): boolean {
  return actor.role === "site_admin" || (Boolean(sellerOwnerEmail(data)) && sellerOwnerEmail(data) === lower(actor.email));
}

// Deleting a whole plan (e.g. demo drafts): the iSEEit plan owner or an administrator (Site or Area Admin).
export function canDeletePlan(actor: StoreActor, data: PlanData): boolean {
  return actor.role === "site_admin" || actor.role === "area_admin" || (Boolean(sellerOwnerEmail(data)) && sellerOwnerEmail(data) === lower(actor.email));
}

// A plan document must be an object whose id matches the URL, with phases, tasks and people lists, and fit the size limit.
export function validatePlan(id: string, data: unknown): { ok: true; data: PlanData & Record<string, unknown> } | { ok: false; error: string } {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, error: "Invalid plan id" };
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Plan data must be an object" };
  const d = data as Record<string, unknown>;
  if (d.id !== id) return { ok: false, error: "Plan id does not match" };
  if (!Array.isArray(d.phases) || !Array.isArray(d.tasks) || !Array.isArray(d.people)) return { ok: false, error: "Plan is missing phases, tasks or people" };
  if (JSON.stringify(d).length > MAX_PLAN_BYTES) return { ok: false, error: "Plan is too large" };
  return { ok: true, data: d as PlanData & Record<string, unknown> };
}

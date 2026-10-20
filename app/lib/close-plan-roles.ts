// The roles people can have on a Close Plan, defined by Site Admins under Admin → Close Plan roles. A role is a name on one side of the
// plan (the customer's or iSEEit's). The built-in roles (the ones templates and the new-plan wizard rely on, `key`) can be renamed and
// reordered but not deleted; any other role can be added, renamed, reordered and deleted.
//
// A person's role is stored on the person in the plan as text. Renaming a role therefore rewrites that text in every plan (renameRolesInPlan)
// so nobody is left with an old name; deleting a role leaves its text on the people who have it (they keep a role, it is just no longer
// offered). Pure parts are unit-tested (tests/close-plan-roles.test.ts); the database helpers at the bottom are thin.
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { closePlanDocuments, closePlanRoleSettings } from "../../db/schema";

export type RoleSide = "buyer" | "seller";
export type RoleDef = { id: string; side: RoleSide; name: string; key?: string };

// The roles the new-plan wizard and the templates know by key. Names are the defaults.
export const BUILTIN: Array<{ key: string; side: RoleSide; name: string }> = [
  { key: "sponsor", side: "buyer", name: "Executive sponsor" }, { key: "lead", side: "buyer", name: "Project lead" }, { key: "tech", side: "buyer", name: "Technical lead" },
  { key: "security", side: "buyer", name: "IT security" }, { key: "procurement", side: "buyer", name: "Procurement" }, { key: "legal", side: "buyer", name: "Legal" },
  { key: "users", side: "buyer", name: "End-user representative" },
  { key: "ae", side: "seller", name: "Account lead" }, { key: "se", side: "seller", name: "Solutions engineer" }, { key: "cs", side: "seller", name: "Customer success" },
  { key: "pm", side: "seller", name: "Project manager" }, { key: "design", side: "seller", name: "Designer" }, { key: "dev", side: "seller", name: "Developer" },
];
export const DEFAULT_ROLES: RoleDef[] = BUILTIN.map(b => ({ id: `builtin-${b.key}`, side: b.side, name: b.name, key: b.key }));
export const MAX_ROLE_NAME = 60, MAX_ROLES_PER_SIDE = 40;

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const isSide = (v: unknown): v is RoleSide => v === "buyer" || v === "seller";

// Checks a role list from the admin page and returns the cleaned list, or the first problem in words. Built-in roles are always kept
// (re-added if the list left one out), keep their key and side, and can only change name and place.
export function validateRoles(input: unknown): { ok: true; roles: RoleDef[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "The role list is missing" };
  const roles: RoleDef[] = [], builtinSeen = new Set<string>(), ids = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>, name = clean(r.name), builtin = BUILTIN.find(b => b.key === r.key);
    if (!isSide(r.side) && !builtin) return { ok: false, error: "A role is not on either side of the plan" };
    if (!name) return { ok: false, error: "A role has no name" };
    if (name.length > MAX_ROLE_NAME) return { ok: false, error: `“${name.slice(0, 20)}…” is longer than ${MAX_ROLE_NAME} characters` };
    if (builtin) {
      if (builtinSeen.has(builtin.key)) continue;
      builtinSeen.add(builtin.key); roles.push({ id: `builtin-${builtin.key}`, side: builtin.side, name, key: builtin.key });
    } else {
      let id = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) && !r.id.startsWith("builtin-") ? r.id : `r-${randomUUID().slice(0, 8)}`;
      if (ids.has(id)) id = `r-${randomUUID().slice(0, 8)}`;
      ids.add(id); roles.push({ id, side: r.side as RoleSide, name });
    }
  }
  for (const b of BUILTIN) if (!builtinSeen.has(b.key)) roles.push({ id: `builtin-${b.key}`, side: b.side, name: b.name, key: b.key });
  for (const side of ["buyer", "seller"] as const) {
    const names = new Map<string, string>();
    for (const r of roles.filter(x => x.side === side)) {
      const k = r.name.toLowerCase();
      if (names.has(k)) return { ok: false, error: `Two roles on the ${side === "buyer" ? "customer" : "iSEEit"} side are called “${r.name}”` };
      names.set(k, r.name);
    }
    if (names.size > MAX_ROLES_PER_SIDE) return { ok: false, error: `At most ${MAX_ROLES_PER_SIDE} roles per side` };
  }
  return { ok: true, roles };
}

export type RoleRename = { side: RoleSide; from: string; to: string };
// Roles whose name changed between two lists (matched by id).
export function diffRenames(prev: RoleDef[], next: RoleDef[]): RoleRename[] {
  const before = new Map(prev.map(r => [r.id, r]));
  return next.filter(r => before.has(r.id) && before.get(r.id)!.name !== r.name).map(r => ({ side: r.side, from: before.get(r.id)!.name, to: r.name }));
}

// Swaps old role names for new ones on the people of one plan (same side, exact match, all renames judged on the ORIGINAL text so a swap
// of two names works). Returns the changed copy and how many people changed, or null when nobody did.
export function renameRolesInPlan(data: Record<string, unknown>, renames: RoleRename[]): { data: Record<string, unknown>; changed: number } | null {
  const people = Array.isArray(data.people) ? data.people as Array<Record<string, unknown>> : [];
  let changed = 0;
  const next = people.map(p => {
    const hit = renames.find(r => r.side === p.side && r.from === p.role);
    if (!hit) return p; changed++; return { ...p, role: hit.to };
  });
  return changed ? { data: { ...data, people: next }, changed } : null;
}

export type RoleUsage = Record<RoleSide, Record<string, { people: number; plans: number }>>;
// How many people (and plans) have each role text, per side.
export function countRoleUsage(plans: Array<Record<string, unknown>>): RoleUsage {
  const usage: RoleUsage = { buyer: {}, seller: {} }, seenInPlan = new Set<string>();
  plans.forEach((data, i) => {
    seenInPlan.clear();
    for (const p of Array.isArray(data.people) ? data.people as Array<Record<string, unknown>> : []) {
      const role = clean(p.role); if (!role || !isSide(p.side)) continue;
      const e = (usage[p.side][role] ||= { people: 0, plans: 0 });
      e.people++; if (!seenInPlan.has(role)) { seenInPlan.add(role); e.plans++; }
    }
    void i;
  });
  return usage;
}

// ---- database ----
export async function loadRoles(): Promise<RoleDef[]> {
  const [row] = await getDb().select().from(closePlanRoleSettings).where(eq(closePlanRoleSettings.id, "default")).limit(1);
  const v = row ? validateRoles(row.roles) : null;
  return v && v.ok ? v.roles : DEFAULT_ROLES;
}
export async function loadRoleUsage(): Promise<RoleUsage> {
  const rows = await getDb().select({ data: closePlanDocuments.data }).from(closePlanDocuments).where(isNull(closePlanDocuments.deletedAt));
  return countRoleUsage(rows.map(r => r.data as Record<string, unknown>));
}

// Saves the list and rewrites renamed roles on the people of every plan (a new version of each plan that changed, so open pages merge it).
export async function saveRoles(roles: RoleDef[], userId: number | null): Promise<{ renames: RoleRename[]; people: number; plans: number }> {
  const prev = await loadRoles(), renames = diffRenames(prev, roles);
  await getDb().insert(closePlanRoleSettings).values({ id: "default", roles, updatedBy: userId })
    .onConflictDoUpdate({ target: closePlanRoleSettings.id, set: { roles, updatedBy: userId, updatedAt: new Date() } });
  let people = 0, plans = 0;
  if (renames.length) {
    const rows = await getDb().select({ id: closePlanDocuments.id }).from(closePlanDocuments).where(isNull(closePlanDocuments.deletedAt));
    for (const { id } of rows) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const [row] = await getDb().select().from(closePlanDocuments).where(and(eq(closePlanDocuments.id, id), isNull(closePlanDocuments.deletedAt))).limit(1);
        if (!row) break;
        const r = renameRolesInPlan(row.data as Record<string, unknown>, renames); if (!r) break;
        const [saved] = await getDb().update(closePlanDocuments).set({ data: r.data, version: row.version + 1, updatedBy: userId, updatedAt: new Date() })
          .where(and(eq(closePlanDocuments.id, id), eq(closePlanDocuments.version, row.version))).returning({ id: closePlanDocuments.id });
        if (saved) { people += r.changed; plans++; break; }
      }
    }
  }
  return { renames, people, plans };
}

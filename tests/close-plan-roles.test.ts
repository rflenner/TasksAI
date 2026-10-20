import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN, DEFAULT_ROLES, countRoleUsage, diffRenames, renameRolesInPlan, validateRoles, type RoleDef } from "../app/lib/close-plan-roles";

const ok = (v: ReturnType<typeof validateRoles>) => { if (!v.ok) throw new Error(v.error); return v.roles; };

test("the default list is accepted unchanged", () => {
  assert.deepEqual(ok(validateRoles(DEFAULT_ROLES)), DEFAULT_ROLES);
});
test("built-in roles the list left out are re-added; custom roles are kept", () => {
  const roles = ok(validateRoles([{ id: "x", side: "buyer", name: "Champion" }]));
  assert.deepEqual(roles.filter(r => r.key).map(r => r.key).sort(), BUILTIN.map(b => b.key).sort());
  const champ = roles.find(r => r.name === "Champion");
  assert.equal(champ?.side, "buyer"); assert.equal(champ?.id, "x");
});
test("a built-in can be renamed but not moved to the other side", () => {
  const r = ok(validateRoles([{ key: "sponsor", side: "seller", name: "Economic buyer" }])).find(x => x.key === "sponsor");
  assert.deepEqual(r, { id: "builtin-sponsor", side: "buyer", name: "Economic buyer", key: "sponsor" });
});
test("blank, overlong and duplicate names are rejected (per side, ignoring case)", () => {
  assert.equal(validateRoles([{ side: "buyer", name: "  " }]).ok, false);
  assert.equal(validateRoles([{ side: "buyer", name: "x".repeat(61) }]).ok, false);
  assert.equal(validateRoles([{ side: "buyer", name: "Champion" }, { side: "buyer", name: "champion" }]).ok, false);
  assert.equal(validateRoles([{ side: "buyer", name: "Champion" }, { side: "seller", name: "Champion" }]).ok, true);
  assert.equal(validateRoles([{ key: "legal", name: "Procurement" }]).ok, false);
  assert.equal(validateRoles("nope").ok, false);
  assert.equal(validateRoles([{ name: "Champion" }]).ok, false);
});
test("extra spaces collapse and a client id that looks built in is not trusted", () => {
  const r = ok(validateRoles([{ id: "builtin-evil", side: "seller", name: "  Field   engineer " }])).find(x => x.name === "Field engineer");
  assert.ok(r); assert.notEqual(r.id, "builtin-evil");
});

const next: RoleDef[] = DEFAULT_ROLES.map(r => r.key === "sponsor" ? { ...r, name: "Economic buyer" } : r);
test("renamed roles are found by id", () => {
  assert.deepEqual(diffRenames(DEFAULT_ROLES, next), [{ side: "buyer", from: "Executive sponsor", to: "Economic buyer" }]);
  assert.deepEqual(diffRenames(DEFAULT_ROLES, DEFAULT_ROLES), []);
});
test("a rename rewrites matching people on the same side only and leaves the input alone", () => {
  const plan = { title: "T", people: [{ id: "a", side: "buyer", role: "Executive sponsor" }, { id: "b", side: "seller", role: "Executive sponsor" }, { id: "c", side: "buyer", role: "Legal" }, { id: "d", side: "buyer" }] };
  const r = renameRolesInPlan(plan, diffRenames(DEFAULT_ROLES, next));
  assert.ok(r); assert.equal(r.changed, 1);
  assert.deepEqual((r.data.people as Array<{ role?: string }>).map(p => p.role), ["Economic buyer", "Executive sponsor", "Legal", undefined]);
  assert.equal(r.data.title, "T"); assert.equal(plan.people[0].role, "Executive sponsor");
});
test("nobody to change gives null; swapping two names works", () => {
  assert.equal(renameRolesInPlan({ people: [] }, diffRenames(DEFAULT_ROLES, next)), null);
  assert.equal(renameRolesInPlan({}, []), null);
  const swap = renameRolesInPlan({ people: [{ side: "buyer", role: "A" }, { side: "buyer", role: "B" }] }, [{ side: "buyer", from: "A", to: "B" }, { side: "buyer", from: "B", to: "A" }]);
  assert.deepEqual((swap!.data.people as Array<{ role: string }>).map(p => p.role), ["B", "A"]);
});
test("role usage counts people and plans per side", () => {
  const u = countRoleUsage([
    { people: [{ side: "buyer", role: "Legal" }, { side: "buyer", role: "Legal" }, { side: "seller", role: "Account lead" }] },
    { people: [{ side: "buyer", role: "Legal" }, { side: "buyer", role: "" }] },
  ]);
  assert.deepEqual(u.buyer.Legal, { people: 3, plans: 2 });
  assert.deepEqual(u.seller["Account lead"], { people: 1, plans: 1 });
});

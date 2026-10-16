import assert from "node:assert/strict";
import test from "node:test";
import { canAccessPlan, canCreatePlan, canDeletePlan, canManagePlanLinks, memberEmails, sellerOwnerEmail, validatePlan } from "../app/lib/close-plan-store";

// Fictional data only — this repository is public.
const plan = {
  id: "pl1", title: "Rollout", account: "Meridian Biotech",
  planOwners: { seller: "s1", buyer: "b1" },
  people: [
    { id: "s1", side: "seller", email: "Owner@ISEEIT.example" },
    { id: "s2", side: "seller", email: "member@iseeit.example" },
    { id: "s3", side: "seller", email: "" },
    { id: "b1", side: "buyer", email: "olivia.grant@meridian-bio.example" },
  ],
  phases: [], tasks: [],
};

test("memberEmails lists iSEEit members only, lowercased, without blanks", () => {
  assert.deepEqual(memberEmails(plan), ["member@iseeit.example", "owner@iseeit.example"]);
  assert.deepEqual(memberEmails({}), []);
});

test("canAccessPlan: site admins, the creator and iSEEit members — never customer contacts", () => {
  const row = { memberEmails: memberEmails(plan), createdBy: 7 };
  assert.equal(canAccessPlan({ id: 1, email: "x@iseeit.example", role: "site_admin" }, row), true);
  assert.equal(canAccessPlan({ id: 7, email: "creator@iseeit.example", role: "area_admin" }, row), true);
  assert.equal(canAccessPlan({ id: 2, email: "MEMBER@iseeit.example", role: "collaborator" }, row), true);
  assert.equal(canAccessPlan({ id: 3, email: "olivia.grant@meridian-bio.example", role: "collaborator" }, row), false);
  assert.equal(canAccessPlan({ id: 4, email: "other@iseeit.example", role: "area_admin" }, row), false);
});

test("canCreatePlan is limited to admins", () => {
  assert.equal(canCreatePlan({ email: "a", role: "site_admin" }), true);
  assert.equal(canCreatePlan({ email: "a", role: "area_admin" }), true);
  assert.equal(canCreatePlan({ email: "a", role: "collaborator" }), false);
  assert.equal(canCreatePlan({ email: "a", role: "readonly" }), false);
});

test("canDeletePlan: the iSEEit plan owner or an administrator; links stay with the owner and site admins", () => {
  assert.equal(sellerOwnerEmail(plan), "owner@iseeit.example");
  assert.equal(canDeletePlan({ email: "owner@iseeit.example", role: "collaborator" }, plan), true);
  assert.equal(canDeletePlan({ email: "member@iseeit.example", role: "area_admin" }, plan), true);
  assert.equal(canDeletePlan({ email: "member@iseeit.example", role: "collaborator" }, plan), false);
  assert.equal(canManagePlanLinks({ email: "member@iseeit.example", role: "area_admin" }, plan), false);
  assert.equal(canManagePlanLinks({ email: "owner@iseeit.example", role: "collaborator" }, plan), true);
  assert.equal(canDeletePlan({ email: "anyone@iseeit.example", role: "site_admin" }, plan), true);
  assert.equal(canDeletePlan({ email: "", role: "collaborator" }, { people: [], planOwners: {} }), false);
});

test("validatePlan checks the id, the shape and the size", () => {
  assert.equal(validatePlan("pl1", plan).ok, true);
  assert.equal(validatePlan("other", plan).ok, false);
  assert.equal(validatePlan("bad id!", plan).ok, false);
  assert.equal(validatePlan("pl1", { id: "pl1", tasks: [] }).ok, false);
  assert.equal(validatePlan("pl1", null).ok, false);
  assert.equal(validatePlan("pl1", { ...plan, notes: "x".repeat(2_100_000) }).ok, false);
});

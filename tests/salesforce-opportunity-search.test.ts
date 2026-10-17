import assert from "node:assert/strict";
import test from "node:test";
import { isOpportunityId, mapOpportunities, opportunitySearchSoql } from "../app/lib/salesforce-opportunity-search";

// Fictional data only — this repository is public.
test("the search matches every word against the opportunity or account name", () => {
  assert.equal(opportunitySearchSoql("Meridian rollout"), "SELECT Id, Name, StageName, CloseDate, Account.Name, Owner.Name FROM Opportunity WHERE (Name LIKE '%Meridian%' OR Account.Name LIKE '%Meridian%') AND (Name LIKE '%rollout%' OR Account.Name LIKE '%rollout%') ORDER BY LastModifiedDate DESC LIMIT 10");
  assert.equal(opportunitySearchSoql(""), null);
  assert.equal(opportunitySearchSoql("a"), null);
  assert.equal(opportunitySearchSoql("%_ \"\\"), null);
});

test("user text can't break out of the SOQL string or add wildcards", () => {
  const q = opportunitySearchSoql(`x' OR Name != '`)!;
  assert.ok(q.includes("LIKE '%x\\'%'"));
  // Every literal opens and closes with its own quote: all quotes inside the typed words are escaped.
  assert.equal((q.replace(/\\'/g, "").match(/'/g) || []).length, 2 * (q.match(/LIKE/g) || []).length);
  const wild = opportunitySearchSoql("50%_off\\")!;
  assert.ok(!wild.includes("%_") && !wild.includes("\\\\"));
  assert.equal((opportunitySearchSoql("a b c d e f g")!.match(/Name LIKE/g) || []).length, 8);
});

test("opportunity ids and result mapping", () => {
  assert.equal(isOpportunityId("006Qs00000nLiA4IAK"), true);
  assert.equal(isOpportunityId("006Qs00000nLiA4"), true);
  assert.equal(isOpportunityId("001Qs00000nLiA4IAK"), false);
  assert.equal(isOpportunityId("Meridian"), false);
  assert.deepEqual(mapOpportunities([{ Id: "006A", Name: "Rollout", StageName: "Discovery", CloseDate: "2026-12-04", Account: { Name: "Meridian" }, Owner: { Name: "Sam" } }, { Id: "006B", Name: null, StageName: null, CloseDate: null }]),
    [{ id: "006A", name: "Rollout", account: "Meridian", stage: "Discovery", closeDate: "2026-12-04", owner: "Sam" }, { id: "006B", name: "(no name)", account: "", stage: "", closeDate: null, owner: "" }]);
});

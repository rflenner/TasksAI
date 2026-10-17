import assert from "node:assert/strict";
import test from "node:test";
import { closePlanSoql, isSalesforceId, mapPhases } from "../app/lib/salesforce-checkpoints";

test("isSalesforceId accepts 15- and 18-character ids only", () => {
  assert.equal(isSalesforceId("006Kj00000AbCdE"), true);
  assert.equal(isSalesforceId("006Kj00000AbCdEFGH"), true);
  for (const value of ["", "006Kj00000AbCd", "006Kj00000AbCdEF", "006Kj00000AbCdEFGHI", "006Kj00000AbCd'", "006' OR Id != '"]) assert.equal(isSalesforceId(value), false, value);
});

test("closePlanSoql filters by the opportunity, keeps close-plan checkpoints only, and includes the description field", () => {
  const soql = closePlanSoql("006Kj00000AbCdEFGH");
  assert.match(soql, /FROM iseeit__Current_Phase__c WHERE iseeit__Opportunity__c = '006Kj00000AbCdEFGH' ORDER BY iseeit__Phase_Order__c ASC$/);
  assert.match(soql, /FROM iseeit__iSEEit_current_Checkpoints__r WHERE iseeit__Is_From_Close_Plan__c = true ORDER BY iseeit__Close_Plan_Order__c ASC\)/);
  assert.match(soql, /iseeit__Checklist_Description__c/);
});

test("closePlanSoql refuses anything that isn't a Salesforce id, so nothing can be injected into the query", () => {
  assert.throws(() => closePlanSoql("006' OR Name != '"));
  assert.throws(() => closePlanSoql(""));
});

test("mapPhases flattens Salesforce's nested records, tolerating phases with no checkpoints and blank fields", () => {
  const phases = mapPhases([
    { Id: "a01000000000001AAA", iseeit__Title__c: "Discovery", iseeit__Phase_Order__c: 1, iseeit__Start_Date__c: "2026-10-01", iseeit__End_Date__c: "2026-10-15", iseeit__iSEEit_current_Checkpoints__r: { records: [
      { Id: "a02000000000001AAA", iseeit__Title__c: "Identify champion", iseeit__Status__c: true, iseeit__Phase_Checkpoint_Status__c: "Completed", iseeit__Deadline__c: "2026-10-10", iseeit__Phase_Checkpoint_Owner__c: "Seller", iseeit__Close_Plan_Order__c: 1, iseeit__Checklist_Description__c: "Ada", iseeit__Default_Checklists__r: { iseeit__Required_Or_Optional_Checkpoint__c: "Required" } },
      { Id: "a02000000000002AAA", iseeit__Title__c: null, iseeit__Status__c: null, iseeit__Phase_Checkpoint_Status__c: null, iseeit__Deadline__c: null, iseeit__Phase_Checkpoint_Owner__c: null, iseeit__Close_Plan_Order__c: 2, iseeit__Checklist_Description__c: null, iseeit__Default_Checklists__r: null },
    ] } },
    { Id: "a01000000000002AAA", iseeit__Title__c: null, iseeit__Phase_Order__c: 2, iseeit__Start_Date__c: null, iseeit__End_Date__c: null, iseeit__iSEEit_current_Checkpoints__r: null },
  ]);
  assert.equal(phases.length, 2);
  assert.deepEqual(phases[0].checkpoints[0], { id: "a02000000000001AAA", title: "Identify champion", status: true, phaseCheckpointStatus: "Completed", deadline: "2026-10-10", owner: "Seller", order: 1, required: "Required", description: "Ada" });
  assert.equal(phases[0].checkpoints[1].title, "Untitled checkpoint");
  assert.equal(phases[0].checkpoints[1].status, false);
  assert.equal(phases[0].checkpoints[1].description, "");
  assert.equal(phases[0].checkpoints[1].required, null);
  assert.equal(phases[1].title, "Untitled phase");
  assert.deepEqual(phases[1].checkpoints, []);
});

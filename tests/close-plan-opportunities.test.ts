import assert from "node:assert/strict";
import test from "node:test";
import { isOpenStage, mergeContacts, searchOpportunities } from "../app/lib/close-plan-opportunities";

// Fictional data only — this repository is public.
const accounts = new Map([["acc1", "Meridian Biotech"], ["acc2", "Nordwind Logistics"], ["acc3", "Alpina Health"]]);
const opps = [
  { opportunity_id: "o1", opportunity_name: "Meridian Biotech", account_id: "acc1", stage: "Closed Won", amount: 14720, close_date: "2025-10-31T00:00:00.000Z" },
  { opportunity_id: "o2", opportunity_name: "Meridian Biotech", account_id: "acc1", stage: "Discovery", amount: 14700, close_date: "2026-11-30T00:00:00.000Z" },
  { opportunity_id: "o3", opportunity_name: "Sales AI EMEA rollout", account_id: "acc2", stage: "Qualification", amount: 38400, close_date: "2026-12-15T00:00:00.000Z" },
  { opportunity_id: "o4", opportunity_name: "Add. Licenses - Meridian", account_id: "acc1", stage: "Proposal", amount: 468, close_date: "2026-10-20T00:00:00.000Z" },
  { opportunity_id: "o5", opportunity_name: "Coaching pilot", account_id: "acc3", stage: "Discovery", amount: null, close_date: null },
];

test("searchOpportunities matches opportunity or account name, every word, accent-insensitive", () => {
  assert.deepEqual(searchOpportunities(opps, accounts, "nordwind").map(h => h.id), ["o3"]);
  assert.deepEqual(searchOpportunities(opps, accounts, "emea nordwind").map(h => h.id), ["o3"]);
  assert.deepEqual(searchOpportunities(opps, accounts, "alpina pilot").map(h => h.id), ["o5"]);
  assert.deepEqual(searchOpportunities(opps, accounts, "zzz"), []);
  assert.deepEqual(searchOpportunities(opps, accounts, "  "), []);
});

test("searchOpportunities ranks open before closed, then name-starts-with, then nearest close date", () => {
  const ids = searchOpportunities(opps, accounts, "meridian").map(h => h.id);
  assert.deepEqual(ids, ["o4", "o2", "o1"]);
  const hit = searchOpportunities(opps, accounts, "meridian")[1];
  assert.equal(hit.accountName, "Meridian Biotech");
  assert.equal(hit.closeDate, "2026-11-30");
  assert.equal(hit.open, true);
});

test("searchOpportunities respects the limit", () => {
  assert.equal(searchOpportunities(opps, accounts, "e", 2).length, 2);
});

test("isOpenStage treats Closed Won and Closed Lost as closed", () => {
  assert.equal(isOpenStage("Closed Won"), false);
  assert.equal(isOpenStage("closed lost"), false);
  assert.equal(isOpenStage("Discovery"), true);
  assert.equal(isOpenStage(null), true);
});

test("mergeContacts collapses a full record, an email-only record and a handle-only record into one person", () => {
  const merged = mergeContacts([
    { contact_id: "c1", contact_name: "olivia.grant", email: null, title: null },
    { contact_id: "c2", contact_name: "Olivia Grant", email: null, title: "Commercial Enablement Lead" },
    { contact_id: "c3", contact_name: "olivia.grant@meridian-bio.example", email: "olivia.grant@meridian-bio.example", title: null },
    { contact_id: "c4", contact_name: "Lukas Brenner", email: null, title: "Sr. Director" },
    { contact_id: "c5", contact_name: "'Hannah  Weber'", email: "Hannah.Weber@meridian-bio.example", title: "VP" },
  ]);
  assert.deepEqual(merged.map(c => c.name), ["Hannah Weber", "Lukas Brenner", "Olivia Grant"]);
  const olivia = merged.find(c => c.name === "Olivia Grant")!;
  assert.equal(olivia.email, "olivia.grant@meridian-bio.example");
  assert.equal(olivia.title, "Commercial Enablement Lead");
  assert.deepEqual(olivia.contactIds.sort(), ["c1", "c2", "c3"]);
  assert.equal(merged.find(c => c.name === "Hannah Weber")!.email, "hannah.weber@meridian-bio.example");
  assert.equal(merged.find(c => c.name === "Lukas Brenner")!.email, "");
});

test("mergeContacts gives an email-only person a readable name", () => {
  assert.deepEqual(mergeContacts([{ contact_id: "c1", contact_name: "", email: "elena.rossi@meridian-bio.example" }]).map(c => c.name), ["Elena Rossi"]);
});

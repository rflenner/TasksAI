import assert from "node:assert/strict";
import test from "node:test";
import { cleanName, extractContacts, involvesRegisteredUser, mapActionItemToTask, nextCalendarDay, resolvePersonName, type SalesAIActionItem } from "../app/lib/sales-ai-mapping";

test("nextCalendarDay: the exact bug found live — 2026-09-02 (today) becomes 2026-09-03, not itself", () => {
  assert.equal(nextCalendarDay("2026-09-02"), "2026-09-03");
});

test("nextCalendarDay: rolls over a month boundary correctly", () => {
  assert.equal(nextCalendarDay("2026-08-31"), "2026-09-01");
});

test("nextCalendarDay: rolls over a year boundary correctly", () => {
  assert.equal(nextCalendarDay("2026-12-31"), "2027-01-01");
});

const baseItem = (overrides: Partial<SalesAIActionItem> = {}): SalesAIActionItem => ({
  action_item_id: "8f57ca3f-fe7a-4d7b-900e-81a53c7cf572",
  description: "Review and discuss playbooks with Pavneetkaur Saluja and Sudhanshu Kumawat before implementation.",
  notes: "Rizan Flenner to coordinate with Pavneetkaur Saluja and Sudhanshu Kumawat to review and walk through the playbooks.",
  citation: { user: "Rizan Flenner", quote: "So let's get together on this, on these playbooks, right?" },
  due_date: "2026-09-07T00:00:00.000Z",
  status: "open",
  created_at: "2026-09-02T09:05:38.509Z",
  owner_id: "003Qs00000IyC5ZIAV",
  owner_name: "Rizan Flenner",
  owner_email: "rizan@iseeit.com",
  recipients: [{ contact_id: "003Qs00000T7fQlIAJ", name: "Pavneet Kaur", email: "pavneetkaur.saluja@habilelabs.io" }],
  account_id: "00106000023md40AAA",
  opportunity_id: null,
  meeting_id: "rY+dqFf2S/KvQWrSaO1e0w==",
  ...overrides,
});

test("cleanName: strips stray quotes and collapses whitespace, the real data-quality bug found live", () => {
  assert.equal(cleanName("'Avni  Bardiya'"), "Avni Bardiya");
  assert.equal(cleanName("  Drew Klein  "), "Drew Klein");
  assert.equal(cleanName(null), "");
  assert.equal(cleanName(undefined), "");
});

test("resolvePersonName: a registered user's email wins over Sales AI's own name spelling", () => {
  const registered = new Map([["rizan@iseeit.com", "Rizan Flenner"]]);
  assert.equal(resolvePersonName("rizan@iseeit.com", "Riz Flenner", registered), "Rizan Flenner");
});

test("resolvePersonName: falls back to Sales AI's cleaned name when there's no registered match", () => {
  const registered = new Map([["rizan@iseeit.com", "Rizan Flenner"]]);
  assert.equal(resolvePersonName("dinesh@example.com", "  dinesh choudhary  ", registered), "dinesh choudhary");
});

test("resolvePersonName: email matching is case-insensitive", () => {
  const registered = new Map([["rizan@iseeit.com", "Rizan Flenner"]]);
  assert.equal(resolvePersonName("Rizan@ISeeIt.com", "whatever", registered), "Rizan Flenner");
});

test("involvesRegisteredUser: true when the owner's email matches", () => {
  const item = baseItem({ recipients: [] });
  assert.ok(involvesRegisteredUser(item, new Set(["rizan@iseeit.com"])));
});

test("involvesRegisteredUser: true when any recipient's email matches, even if the owner doesn't", () => {
  const item = baseItem({ owner_email: "someone-else@example.com" });
  assert.ok(involvesRegisteredUser(item, new Set(["pavneetkaur.saluja@habilelabs.io"])));
});

test("involvesRegisteredUser: false when nobody involved is registered", () => {
  const item = baseItem();
  assert.equal(involvesRegisteredUser(item, new Set(["nobody@example.com"])), false);
});

test("mapActionItemToTask: full mapping against the real confirmed shape", () => {
  const task = mapActionItemToTask(baseItem(), {
    registeredNameByEmail: new Map([["rizan@iseeit.com", "Rizan Flenner"]]),
    accountNameById: new Map([["00106000023md40AAA", "Habilelabs"]]),
    opportunityNameById: new Map(),
  });
  assert.equal(task.subject, "Review and discuss playbooks with Pavneetkaur Saluja and Sudhanshu Kumawat before implementation.");
  assert.match(task.description, /Rizan Flenner to coordinate/);
  assert.equal(task.owner, "Rizan Flenner");
  assert.deepEqual(task.recipients, ["Pavneet Kaur"]);
  assert.deepEqual(task.collaborators, []);
  assert.equal(task.due, "2026-09-07");
  assert.equal(task.status, "Open");
  assert.equal(task.accountId, "00106000023md40AAA");
  assert.equal(task.accountName, "Habilelabs");
  assert.equal(task.opportunityId, null);
  assert.equal(task.opportunityName, null);
  assert.equal(task.meetingId, "rY+dqFf2S/KvQWrSaO1e0w==");
  assert.equal(task.externalSource, "sales-ai");
  assert.equal(task.externalId, "8f57ca3f-fe7a-4d7b-900e-81a53c7cf572");
  assert.equal(task.citationUser, "Rizan Flenner");
  assert.match(task.citationQuote!, /let's get together/);
  assert.equal(task.source, "Sales AI");
  assert.equal(task.createdBy, "Sales AI sync");
});

test("mapActionItemToTask: status completed maps to Closed, open/overdue both map to Open", () => {
  const lookup = { registeredNameByEmail: new Map(), accountNameById: new Map(), opportunityNameById: new Map() };
  assert.equal(mapActionItemToTask(baseItem({ status: "completed" }), lookup).status, "Closed");
  assert.equal(mapActionItemToTask(baseItem({ status: "open" }), lookup).status, "Open");
  assert.equal(mapActionItemToTask(baseItem({ status: "overdue" }), lookup).status, "Open");
});

test("mapActionItemToTask: a missing due_date leaves due blank rather than crashing", () => {
  const lookup = { registeredNameByEmail: new Map(), accountNameById: new Map(), opportunityNameById: new Map() };
  assert.equal(mapActionItemToTask(baseItem({ due_date: null }), lookup).due, "");
});

test("mapActionItemToTask: unresolvable account/opportunity ids still get stored, just with a null name", () => {
  const task = mapActionItemToTask(baseItem({ account_id: "unknown-id" }), { registeredNameByEmail: new Map(), accountNameById: new Map(), opportunityNameById: new Map() });
  assert.equal(task.accountId, "unknown-id");
  assert.equal(task.accountName, null);
});

test("mapActionItemToTask: an owner with no registered match and no name falls back to Unassigned, never blank", () => {
  const task = mapActionItemToTask(baseItem({ owner_email: null, owner_name: null }), { registeredNameByEmail: new Map(), accountNameById: new Map(), opportunityNameById: new Map() });
  assert.equal(task.owner, "Unassigned");
});

test("extractContacts: owner and recipient(s) both produce a candidate when they have a Sales AI id", () => {
  const candidates = extractContacts(baseItem(), new Map([["00106000023md40AAA", "Habilelabs"]]));
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], { name: "Rizan Flenner", email: "rizan@iseeit.com", salesAiContactId: "003Qs00000IyC5ZIAV", salesAiAccountId: "00106000023md40AAA", salesAiAccountName: "Habilelabs" });
  assert.deepEqual(candidates[1], { name: "Pavneet Kaur", email: "pavneetkaur.saluja@habilelabs.io", salesAiContactId: "003Qs00000T7fQlIAJ", salesAiAccountId: "00106000023md40AAA", salesAiAccountName: "Habilelabs" });
});

test("extractContacts: a recipient with no contact_id is skipped, not included with a null key", () => {
  const item = baseItem({ owner_id: null, recipients: [{ contact_id: null, name: "No Id Person", email: "x@example.com" }] });
  assert.deepEqual(extractContacts(item, new Map()), []);
});

test("extractContacts: cleans names the same way cleanName does", () => {
  const item = baseItem({ owner_id: null, recipients: [{ contact_id: "c1", name: "'Avni  Bardiya'", email: null }] });
  const candidates = extractContacts(item, new Map());
  assert.equal(candidates[0].name, "Avni Bardiya");
});

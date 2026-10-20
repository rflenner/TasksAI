import assert from "node:assert/strict";
import test from "node:test";
import { bestPhoto, contactIdsFor, contactsByEmailQuery, decide, imageType, newestPhotos, photoQuery } from "../app/lib/close-plan-photos";

// Fictional data only — this repository is public. Salesforce-style Ids are made up.
const C1 = "003000000000001AAA", C2 = "003000000000002AAA", C3 = "003000000000003AAA";
const A1 = "00P000000000001AAA", A2 = "00P000000000002AAA", A3 = "00P000000000003AAA";

test("photoQuery asks for the org chart photo of valid contact ids only, once each", () => {
  const q = photoQuery([C1, C1, C2, "003' OR Name != '", "005000000000001AAA"]);
  assert.match(q!, /Name = 'Profile_Picture\.jpg'/);
  assert.match(q!, /ParentId IN \('003000000000001AAA','003000000000002AAA'\)/);
  assert.equal(photoQuery([]), null);
  assert.equal(photoQuery(["not-an-id"]), null);
});

test("contactsByEmailQuery lowercases, de-duplicates and refuses anything that could break the query", () => {
  const q = contactsByEmailQuery(["Hannah.Weber@meridian-bio.example", "hannah.weber@meridian-bio.example", "x' OR Id != '@a.b", "no-at-sign"]);
  assert.equal(q, "SELECT Id, Email FROM Contact WHERE Email IN ('hannah.weber@meridian-bio.example')");
  assert.equal(contactsByEmailQuery([""]), null);
});

test("newestPhotos keeps the newest of a contact's duplicate photos", () => {
  const newest = newestPhotos([
    { Id: A1, ParentId: C1, LastModifiedDate: "2026-07-14T10:00:00.000+0000" },
    { Id: A2, ParentId: C1, LastModifiedDate: "2026-10-15T16:00:00.000+0000" },
    { Id: A3, ParentId: C2, LastModifiedDate: "2025-01-01T00:00:00.000+0000" },
    { Id: "bad", ParentId: C3, LastModifiedDate: "2026-10-20T00:00:00.000+0000" },
  ]);
  assert.equal(newest.get(C1)?.attachmentId, A2);
  assert.equal(newest.get(C2)?.attachmentId, A3);
  assert.equal(newest.has(C3), false);
});

test("contactIdsFor uses a customer's linked Contact first, then Contacts with the same email (iSEEit team too)", () => {
  const byEmail = new Map([["lukas.brandt@meridian-bio.example", [C2, C1]], ["hannah@iseeit.example", [C3]]]);
  assert.deepEqual(contactIdsFor({ id: "b1", side: "buyer", sfdcContactId: C1, email: "Lukas.Brandt@meridian-bio.example" }, byEmail), [C1, C2]);
  assert.deepEqual(contactIdsFor({ id: "s1", side: "seller", email: "hannah@iseeit.example" }, byEmail), [C3]);
  assert.deepEqual(contactIdsFor({ id: "s2", side: "seller", email: "nobody@iseeit.example" }, byEmail), []);
});

test("bestPhoto picks the newest photo across a person's Contacts", () => {
  const newest = new Map([[C1, { attachmentId: A1, at: "2026-01-01" }], [C2, { attachmentId: A2, at: "2026-09-01" }]]);
  assert.equal(bestPhoto([C1, C2, C3], newest), A2);
  assert.equal(bestPhoto([C3], newest), null);
});

test("decide: an upload is never replaced; Salesforce wins over Sales AI; Sales AI fills the gaps", () => {
  assert.deepEqual(decide({ id: "a", photo: "upload-1", photoSource: "upload" }, A1), { kind: "keep" });
  assert.deepEqual(decide({ id: "b", photo: A1, photoSource: "salesforce" }, A1), { kind: "keep" });
  assert.deepEqual(decide({ id: "c", photo: "salesai:x.jpg", photoSource: "salesai" }, A2), { kind: "salesforce", attachmentId: A2 });
  assert.deepEqual(decide({ id: "d" }, null), { kind: "salesai" });
  assert.deepEqual(decide({ id: "e", photo: A1, photoSource: "salesforce" }, null), { kind: "salesai" });
});

test("imageType trusts the bytes, not the label", () => {
  assert.equal(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(imageType(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(imageType(new TextEncoder().encode("RIFF1234WEBPVP8 ")), "image/webp");
  assert.equal(imageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(imageType(new Uint8Array()), null);
});

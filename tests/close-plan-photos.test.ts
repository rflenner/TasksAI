import assert from "node:assert/strict";
import test from "node:test";
import { imageType, newestPhotos, photoQuery, photoWork } from "../app/lib/close-plan-photos";

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

test("newestPhotos keeps the newest of a contact's duplicate photos", () => {
  const newest = newestPhotos([
    { Id: A1, ParentId: C1, LastModifiedDate: "2026-07-14T10:00:00.000+0000" },
    { Id: A2, ParentId: C1, LastModifiedDate: "2026-10-15T16:00:00.000+0000" },
    { Id: A3, ParentId: C2, LastModifiedDate: "2025-01-01T00:00:00.000+0000" },
    { Id: "bad", ParentId: C3, LastModifiedDate: "2026-10-20T00:00:00.000+0000" },
  ]);
  assert.equal(newest.get(C1), A2);
  assert.equal(newest.get(C2), A3);
  assert.equal(newest.has(C3), false);
});

test("photoWork fetches new or changed photos, clears removed ones, and skips the iSEEit side", () => {
  const people = [
    { id: "b1", side: "buyer", sfdcContactId: C1 },               // new photo
    { id: "b2", side: "buyer", sfdcContactId: C2, photo: A3 },    // unchanged
    { id: "b3", side: "buyer", sfdcContactId: C3, photo: A1 },    // removed in Salesforce
    { id: "b4", side: "buyer" },                                  // not linked to Salesforce
    { id: "s1", side: "seller", sfdcContactId: C1 },              // iSEEit people use User photos, not these
  ];
  const work = photoWork(people, new Map([[C1, A2], [C2, A3]]));
  assert.deepEqual(work.fetch, [{ personId: "b1", attachmentId: A2 }]);
  assert.deepEqual(work.clear, ["b3"]);
});

test("imageType trusts the bytes, not the label", () => {
  assert.equal(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(imageType(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(imageType(new TextEncoder().encode("RIFF1234WEBPVP8 ")), "image/webp");
  assert.equal(imageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(imageType(new Uint8Array()), null);
});

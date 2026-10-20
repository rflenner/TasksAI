import assert from "node:assert/strict";
import test from "node:test";
import { cleanFileName, customerMayAttach, customerSees, isPdf, taskById } from "../app/lib/close-plan-attachments";

const bytes = (s: string) => new TextEncoder().encode(s);

test("only real PDFs pass, whatever the name says", () => {
  assert.equal(isPdf(bytes("%PDF-1.7\n1 0 obj")), true);
  assert.equal(isPdf(bytes("MZ\x90\x00 this is an exe renamed .pdf")), false);
  assert.equal(isPdf(bytes("<html><script>alert(1)</script>")), false);
  assert.equal(isPdf(bytes("%PDF")), false);
  assert.equal(isPdf(new Uint8Array()), false);
});
test("file names are made safe and end in .pdf", () => {
  assert.equal(cleanFileName("Security Questionnaire.pdf"), "Security Questionnaire.pdf");
  assert.equal(cleanFileName("..\\..\\etc\\passwd"), "passwd.pdf");
  assert.equal(cleanFileName("C:/x/y/offer.PDF"), "offer.pdf");
  assert.equal(cleanFileName('a"b<c>.pdf'), "abc.pdf");
  assert.equal(cleanFileName(""), "Document.pdf");
  assert.equal(cleanFileName(".pdf"), "Document.pdf");
  assert.equal(cleanFileName("x".repeat(300) + ".pdf").length, 120);
  assert.ok(!/[\u0000-\u001f]/.test(cleanFileName("a\nb\u0000.pdf")));
});

const plan = {
  people: [
    { id: "s1", side: "seller", name: "Drew" },
    { id: "c1", side: "buyer", name: "Erik", access: { level: "own", create: true } },
    { id: "c2", side: "buyer", name: "Gary", access: { level: "view", create: false } },
    { id: "c3", side: "buyer", name: "Kelly", access: { level: "all", create: true } },
  ],
  tasks: [
    { id: "t1", owner: "c1", shared: true },
    { id: "t2", owner: "s1", shared: true },
    { id: "t3", owner: "c1", shared: false },
    { id: "t4", owner: "s1", shared: true, parent: "t3" },
  ],
};
test("a customer may attach only to shared tasks they can post on", () => {
  assert.equal(customerMayAttach(plan, "c1", "t1"), true);
  assert.equal(customerMayAttach(plan, "c1", "t2"), false);
  assert.equal(customerMayAttach(plan, "c3", "t2"), true);
  assert.equal(customerMayAttach(plan, "c2", "t1"), false);
  assert.equal(customerMayAttach(plan, "c1", "t3"), false);
  assert.equal(customerMayAttach(plan, "c1", "t4"), false);
  assert.equal(customerMayAttach(plan, "s1", "t1"), false);
  assert.equal(customerMayAttach(plan, "c1", "nope"), false);
});
test("a customer sees only shared files on shared tasks", () => {
  assert.equal(customerSees(plan, { taskId: "t1", shared: true }), true);
  assert.equal(customerSees(plan, { taskId: "t1", shared: false }), false);
  assert.equal(customerSees(plan, { taskId: "t3", shared: true }), false);
  assert.equal(customerSees(plan, { taskId: "t4", shared: true }), false);
  assert.equal(customerSees(plan, { taskId: "gone", shared: true }), false);
  assert.equal(taskById(plan, "t2")?.id, "t2");
});

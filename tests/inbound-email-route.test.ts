import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { POST } from "../app/api/webhooks/inbound-email/route";

// The webhook route end to end for mail that is NOT for this app: a validly
// signed `email.received` for another domain on the same Resend account (the
// gofibu invoice inbox) must be answered 200 and ignored — no database lookup,
// no call to Resend's API, no AI extraction. (Mail for this app's own domain
// goes on to the database, so it isn't exercised here.)

const SECRET_BYTES = Buffer.from("test-secret-for-the-webhook");

function signedRequest(payload: unknown) {
  const body = JSON.stringify(payload);
  const id = "msg_test", timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", SECRET_BYTES).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("http://localhost/api/webhooks/inbound-email", {
    method: "POST", body,
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
  });
}

async function withEnvironment<T>(run: () => Promise<T>): Promise<T> {
  const saved = { secret: process.env.RESEND_INBOUND_WEBHOOK_SECRET, domain: process.env.INBOUND_EMAIL_DOMAIN, fetch: globalThis.fetch, log: console.log };
  process.env.RESEND_INBOUND_WEBHOOK_SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
  process.env.INBOUND_EMAIL_DOMAIN = "tasks.iseeit.ai";
  // Any outgoing request (Resend's API, OpenAI) would mean the mail was not ignored.
  globalThis.fetch = (() => { throw new Error("the webhook must not call out for mail that is not its own"); }) as typeof fetch;
  console.log = () => {};
  try { return await run(); } finally {
    if (saved.secret === undefined) delete process.env.RESEND_INBOUND_WEBHOOK_SECRET; else process.env.RESEND_INBOUND_WEBHOOK_SECRET = saved.secret;
    if (saved.domain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN; else process.env.INBOUND_EMAIL_DOMAIN = saved.domain;
    globalThis.fetch = saved.fetch; console.log = saved.log;
  }
}

test("inbound webhook: an email to another domain on the same Resend account is ignored, even from a sender who could be a Task AI user", async () => {
  await withEnvironment(async () => {
    const response = await POST(signedRequest({ type: "email.received", data: { email_id: "em_1", from: "Rizan Flenner <rizan@iseeit.com>", to: ["re-flenner@belege.gofibu.at"], subject: "Rechnung 2026-117" } }));
    assert.equal(response.status, 200);
    const json = await response.json() as { ok?: boolean; ignored?: string };
    assert.equal(json.ok, true);
    assert.match(json.ignored ?? "", /not addressed/);
  });
});

test("inbound webhook: a reply token on someone else's domain is ignored too — the token path sits behind the same check", async () => {
  await withEnvironment(async () => {
    const response = await POST(signedRequest({ type: "email.received", data: { email_id: "em_2", from: "x@example.com", to: ["reply+abc123@belege.gofibu.at"] } }));
    assert.equal(response.status, 200);
    assert.match(((await response.json()) as { ignored?: string }).ignored ?? "", /not addressed/);
  });
});

test("inbound webhook: an email with no recipients named is left alone rather than guessed at", async () => {
  await withEnvironment(async () => {
    const response = await POST(signedRequest({ type: "email.received", data: { email_id: "em_3", from: "x@example.com" } }));
    assert.equal(response.status, 200);
    assert.match(((await response.json()) as { ignored?: string }).ignored ?? "", /not addressed/);
  });
});

test("inbound webhook: a bad signature is still rejected before anything else", async () => {
  await withEnvironment(async () => {
    const request = new Request("http://localhost/api/webhooks/inbound-email", {
      method: "POST", body: JSON.stringify({ type: "email.received", data: { email_id: "em_4", from: "x@example.com", to: ["tasks@tasks.iseeit.ai"] } }),
      headers: { "svix-id": "msg_x", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" },
    });
    assert.equal((await POST(request)).status, 401);
  });
});

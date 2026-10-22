import assert from "node:assert/strict";
import test from "node:test";
import { customerHostRedirect, isCustomerPath } from "../app/lib/close-plan-host";

const env = { customerUrl: "https://closeplan.example", appUrl: "https://app.example" };
const go = (host: string, pathname: string, search = "") => customerHostRedirect({ host, pathname, search, ...env });

test("customer pages, their API and static files are served on the customer address", () => {
  for (const p of ["/p/abcdefghijklmnopqrstuvwxyz", "/unsubscribe/tok123", "/api/close-plans/shared/tok/photos/c1", "/_next/static/chunks/main.js", "/iseeit-logo.png", "/close-plan-rebase.js", "/pdfjs/build/pdf.mjs", "/favicon.svg"])
    assert.equal(go("closeplan.example", p), null, p);
});

test("everything else on the customer address goes to the same path on the main address", () => {
  assert.equal(go("closeplan.example", "/"), "https://app.example/");
  assert.equal(go("closeplan.example", "/login", "?returnTo=%2Fclose-plans"), "https://app.example/login?returnTo=%2Fclose-plans");
  assert.equal(go("closeplan.example", "/close-plans"), "https://app.example/close-plans");
  assert.equal(go("CLOSEPLAN.example", "/api/auth/verify"), "https://app.example/api/auth/verify");
  assert.equal(go("closeplan.example", "/api/tasks"), "https://app.example/api/tasks");
});

test("the main address and other hosts are never redirected", () => {
  assert.equal(go("app.example", "/"), null);
  assert.equal(go("tasks-ai.onrender.com", "/login"), null);
  assert.equal(go("localhost:3000", "/"), null);
});

test("nothing happens without a separate, valid customer address", () => {
  assert.equal(customerHostRedirect({ host: "closeplan.example", pathname: "/", search: "", appUrl: env.appUrl }), null);
  assert.equal(customerHostRedirect({ host: "closeplan.example", pathname: "/", search: "", customerUrl: "closeplan.example", appUrl: env.appUrl }), null);
  assert.equal(customerHostRedirect({ host: "app.example", pathname: "/", search: "", customerUrl: env.appUrl, appUrl: env.appUrl }), null);
});

test("an API path with a dot is not mistaken for a static file", () => {
  assert.equal(isCustomerPath("/api/export.csv"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { customerBase, customerOrigin, internalBase } from "../app/lib/close-plan-urls";

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const saved = { APP_URL: process.env.APP_URL, CLOSEPLAN_URL: process.env.CLOSEPLAN_URL };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test("without CLOSEPLAN_URL nothing changes: customer links use the internal address", () => {
  withEnv({ APP_URL: "https://tasks.flenner.at/", CLOSEPLAN_URL: undefined }, () => {
    assert.equal(internalBase(), "https://tasks.flenner.at");
    assert.equal(customerBase(), "https://tasks.flenner.at");
    assert.equal(customerBase("http://localhost:3000"), "http://localhost:3000", "a request address still wins when no customer address is set");
    assert.equal(customerOrigin(), "");
  });
});

test("with CLOSEPLAN_URL, customer links use it and colleagues' links keep the app address", () => {
  withEnv({ APP_URL: "https://tasks.flenner.at", CLOSEPLAN_URL: "https://closeplan.iseeit.ai/" }, () => {
    assert.equal(customerBase(), "https://closeplan.iseeit.ai");
    assert.equal(customerBase("https://tasks-ai.onrender.com"), "https://closeplan.iseeit.ai", "even when the request came in on another address");
    assert.equal(internalBase(), "https://tasks.flenner.at");
    assert.equal(customerOrigin(), "https://closeplan.iseeit.ai");
  });
});

test("an unusable CLOSEPLAN_URL is ignored", () => {
  withEnv({ APP_URL: "https://tasks.flenner.at", CLOSEPLAN_URL: "not a url" }, () => assert.equal(customerBase(), "https://tasks.flenner.at"));
  withEnv({ APP_URL: "https://tasks.flenner.at", CLOSEPLAN_URL: "ftp://x.test" }, () => assert.equal(customerOrigin(), ""));
});

import assert from "node:assert/strict";
import test from "node:test";

import { checkIntegration } from "./health.mjs";

test("xhs health check reports a missing executable without throwing", async () => {
  const previous = process.env.XHS_CLI_COMMAND;
  process.env.XHS_CLI_COMMAND = "definitely-missing-xhs-command";
  try {
    const result = await checkIntegration({ target: "xhs" });
    assert.equal(result.healthy, false);
    assert.equal(result.installed, false);
    assert.equal(result.code, "XHS_CLI_UNAVAILABLE");
  } finally {
    if (previous === undefined) delete process.env.XHS_CLI_COMMAND;
    else process.env.XHS_CLI_COMMAND = previous;
  }
});

test("cloud health check reports missing configuration without leaking values", async () => {
  const result = await checkIntegration({ target: "cloud-text" });
  assert.equal(result.healthy, false);
  assert.equal(result.code, "API_CONFIG_MISSING");
  assert.equal(result.authenticated, false);
});

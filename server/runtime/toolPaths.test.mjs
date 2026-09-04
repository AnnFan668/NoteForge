import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexProcessEnv,
  resolveCodexCliPath,
  resolveXhsCliCommand,
} from "./toolPaths.mjs";

test("explicit CLI overrides remain authoritative", () => {
  assert.equal(resolveXhsCliCommand({ XHS_CLI_COMMAND: "custom-xhs" }), "custom-xhs");
  assert.equal(resolveCodexCliPath({ CODEX_CLI_PATH: "custom-codex" }), "custom-codex");
});

test("Codex child processes always receive a stable user auth directory", () => {
  const env = buildCodexProcessEnv({ PATH: "test-path", CODEX_HOME: "C:\\auth-home" });
  assert.equal(env.CODEX_HOME, "C:\\auth-home");
  assert.equal(env.PATH, "test-path");
  assert.equal(env.NO_COLOR, "1");
});

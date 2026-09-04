import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCloudChatBody,
  buildCloudNetworkError,
  buildUpstreamHttpError,
} from "./cloudProvider.mjs";

test("Kimi official API uses model-compatible structured output fields", () => {
  const body = buildCloudChatBody({
    payload: { kind: "drafts" },
    modelName: "kimi-k2.6",
    baseUrl: "https://api.moonshot.cn/v1",
    prompt: "Return JSON",
  });

  assert.equal(body.temperature, undefined);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.max_completion_tokens, 5200);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("restricted Node networking returns an actionable launcher message", () => {
  const error = buildCloudNetworkError(Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("socket access denied"), { code: "EACCES" }),
  }));

  assert.equal(error.code, "API_NETWORK_RESTRICTED");
  assert.match(error.message, /NoteForge\.bat/);
});

test("Kimi Code membership API also omits the incompatible fixed temperature", () => {
  const body = buildCloudChatBody({
    payload: { kind: "topics" },
    modelName: "kimi-for-coding",
    baseUrl: "https://api.kimi.com/coding/v1",
    prompt: "Return JSON",
  });

  assert.equal(body.temperature, undefined);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.max_completion_tokens, 3200);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("generic OpenAI-compatible APIs keep legacy compatibility fields", () => {
  const body = buildCloudChatBody({
    payload: { kind: "topics" },
    modelName: "compatible-model",
    baseUrl: "https://example.com/v1",
    prompt: "Return JSON",
  });

  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 3200);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.response_format, undefined);
});

test("DeepSeek official API uses deterministic JSON output without thinking mode", () => {
  const body = buildCloudChatBody({
    payload: { kind: "topics" },
    modelName: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
    prompt: "Return JSON",
  });

  assert.equal(body.temperature, undefined);
  assert.equal(body.max_tokens, 3200);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.thinking, { type: "disabled" });
});

test("upstream HTTP 400 exposes the provider reason without leaking the API key", () => {
  const apiKey = "test-secret-key";
  const text = JSON.stringify({
    error: {
      message: `invalid temperature: only 1 is allowed; key=${apiKey}`,
      type: "invalid_request_error",
    },
  });
  const error = buildUpstreamHttpError({ status: 400, text, apiKey });

  assert.match(error.message, /HTTP 400/);
  assert.match(error.message, /invalid temperature/);
  assert.doesNotMatch(error.message, new RegExp(apiKey));
  assert.doesNotMatch(error.details, new RegExp(apiKey));
});

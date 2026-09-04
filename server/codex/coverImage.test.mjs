import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkerResultText } from "./coverImage.mjs";

test("accepts a worker result JSON without a BOM", () => {
  const payload = parseWorkerResultText(
    '{"status":"complete","image_path":"C:\\\\Temp\\\\image.png","error":null,"caveats":""}',
  );

  assert.equal(payload.status, "complete");
  assert.equal(payload.image_path, "C:\\Temp\\image.png");
});

test("accepts a worker result JSON with a UTF-8 BOM", () => {
  const payload = parseWorkerResultText(
    '\uFEFF{"status":"complete","image_path":"C:\\\\Temp\\\\image.png","error":null,"caveats":""}',
  );

  assert.equal(payload.status, "complete");
  assert.equal(payload.image_path, "C:\\Temp\\image.png");
});

test("reports the actual JSON parse reason for malformed worker output", () => {
  assert.throws(
    () => parseWorkerResultText("not-json"),
    (error) => {
      assert.equal(error.code, "IMAGEGEN_BAD_OUTPUT");
      assert.match(error.message, /result\.json 无法解析/);
      assert.match(error.message, /Unexpected token/);
      return true;
    },
  );
});

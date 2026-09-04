import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildXhsProcessEnv, extractSearchImageUrl, repairInvalidSearchSessionCache } from "./runXhs.mjs";

test("forces UTF-8 and plain output for Windows xhs JSON", () => {
  const env = buildXhsProcessEnv({ PATH: "test-path" });

  assert.equal(env.PATH, "test-path");
  assert.equal(env.PYTHONUTF8, "1");
  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.FORCE_COLOR, "0");
  assert.equal(env.TERM, "dumb");
});

test("quarantines a non-UTF-8 xhs search session cache without touching other files", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "mint-xhs-cache-"));
  const cachePath = path.join(configDir, "search_sessions.json");
  const cookiePath = path.join(configDir, "cookies.json");
  await writeFile(cachePath, Buffer.from([0x7b, 0x22, 0xcf, 0x22, 0x7d]));
  await writeFile(cookiePath, "cookie-marker", "utf8");

  const backupPath = await repairInvalidSearchSessionCache(configDir);

  assert.ok(backupPath?.endsWith(".json.bak"));
  assert.equal(await readFile(cookiePath, "utf8"), "cookie-marker");
});

test("extracts the primary Xiaohongshu cover URL", () => {
  const imageUrl = extractSearchImageUrl({
    note_card: {
      cover: { url_default: "https://sns-webpic.example.com/cover.webp" },
    },
  });

  assert.equal(imageUrl, "https://sns-webpic.example.com/cover.webp");
});

test("falls back to image list and rejects non-http URLs", () => {
  assert.equal(extractSearchImageUrl({ note_card: { cover: { url: "file:///secret" } } }), "");
  assert.equal(
    extractSearchImageUrl({ note_card: { image_list: [{ url_pre: "https://example.com/preview.jpg" }] } }),
    "https://example.com/preview.jpg",
  );
});

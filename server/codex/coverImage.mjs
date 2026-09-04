import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexApiError } from "./validation.mjs";
import { buildCodexProcessEnv, resolveCodexCliPath } from "../runtime/toolPaths.mjs";

const GENERATED_ROUTE_PREFIX = "/generated/covers/";
const IMAGEGEN_TIMEOUT_MS = 600_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const generatedDir = path.join(tmpdir(), "xhs-g4-generated-covers");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function compactText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function assertString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CodexApiError("BAD_REQUEST", `请提供${fieldName}。`);
  }
  return value.trim();
}

function commandPreview(args) {
  const safeArgs = args.slice(0, -1).concat("[imagegen worker prompt]");
  return ["codex", ...safeArgs].join(" ");
}

export function buildCoverImagePrompt(payload) {
  const draft = payload.selectedDraft ?? {};
  const selectedPrompt = payload.selectedPrompt ?? {};

  return [
    "Use case: product-mockup",
    "Asset type: Xiaohongshu 4:5 cover image",
    `Primary request: ${compactText(selectedPrompt.prompt ?? payload.prompt, 1800)}`,
    "Style/medium: photorealistic editorial still-life image with soft pastel claymorphism influence",
    "Composition/framing: vertical 4:5 cover, clean centered still-life composition, enough negative space for short title text",
    "Lighting/mood: soft natural studio light, fresh mint atelier mood, refined and practical",
    "Color palette: mint green, cream white, pale rose, soft lavender, low-saturation summer colors",
    "Materials/textures: fabric, paper, bag, shoes, stationery, color cards, desk surface, plants or flowers if useful",
    `Text (verbatim): "${compactText(draft.title || selectedPrompt.title || payload.keyword, 48)}"`,
    "Constraints: no logos, no watermark, no exaggerated before-after claims, no medical or financial claims",
    "Avoid: real people, portraits, faces, eyes, mouths, hands, fingers, animals, pets, animal silhouettes",
  ].join("\n");
}

function workerPrompt({ payload, imagePath, resultPath }) {
  return `Generate exactly one PNG image with the native image generation tool.

You must use the native \`image_gen.imagegen\` tool. Do not call direct image APIs.
Do not create placeholder art with SVG, Python, PIL, canvas, HTML, screenshots, or code-native drawing.

Image prompt:
${buildCoverImagePrompt(payload)}

Save the final PNG exactly here:
${imagePath}

Then write this minimal worker result JSON exactly here:
${resultPath}

Required JSON shape:
{
  "status": "complete",
  "image_path": "${imagePath}",
  "error": null,
  "caveats": ""
}

If native image generation is unavailable or the image cannot be saved, write the same JSON shape with "status": "failed", "image_path": null, and a concise "error".

Rules:
- Generate exactly one bitmap image.
- The image must be PNG.
- Keep the cover prompt boundary: no real people, no faces, no hands, and no animals.
- Use only native image generation and the file writes required for image.png and result.json.
- If local CLI state or output-file writes are blocked by sandbox permissions, request escalation/outside-sandbox approval immediately.
- Do not ask the user questions.`;
}

function assertPngBytes(bytes, code, message) {
  if (!Buffer.isBuffer(bytes) || bytes.length <= PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new CodexApiError(code, message, 502);
  }

  return bytes.length;
}

async function assertPngFile(filePath) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new CodexApiError("IMAGEGEN_BAD_OUTPUT", "imagegen worker 没有写出 PNG 文件。", 502);
  }

  return assertPngBytes(bytes, "IMAGEGEN_BAD_OUTPUT", "imagegen worker 写出的文件不是合法 PNG。");
}

export function parseWorkerResultText(raw) {
  try {
    return JSON.parse(String(raw ?? "").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new CodexApiError(
      "IMAGEGEN_BAD_OUTPUT",
      `imagegen worker 的 result.json 无法解析：${compactText(error?.message || "未知 JSON 错误", 160)}`,
      502,
    );
  }
}

async function readWorkerResult(resultPath, imagePath) {
  let raw;
  try {
    raw = await readFile(resultPath, "utf8");
  } catch {
    throw new CodexApiError("IMAGEGEN_BAD_OUTPUT", "imagegen worker 没有写出 result.json。", 502);
  }

  const payload = parseWorkerResultText(raw);

  if (payload?.status !== "complete") {
    throw new CodexApiError(
      "IMAGEGEN_FAILED",
      payload?.error || "imagegen worker 生成失败。",
      502,
      payload,
    );
  }

  const reportedPath = String(payload.image_path ?? "").trim();
  if (reportedPath && path.resolve(reportedPath) !== path.resolve(imagePath)) {
    throw new CodexApiError("IMAGEGEN_BAD_OUTPUT", "imagegen worker 返回的图片路径不匹配。", 502, payload);
  }

  return payload;
}

export async function publishGeneratedPng({
  imagePath,
  imageBytes,
  selectedPrompt,
  sourceLabel = "Codex CLI imagegen",
  badImageCode = "IMAGEGEN_BAD_OUTPUT",
  badImageMessage = "生成服务返回的文件不是合法 PNG。",
}) {
  await mkdir(generatedDir, { recursive: true });
  const fileName = `cover-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
  const filePath = path.join(generatedDir, fileName);
  let byteLength;

  if (imageBytes) {
    const bytes = Buffer.from(imageBytes);
    byteLength = assertPngBytes(bytes, badImageCode, badImageMessage);
    await writeFile(filePath, bytes);
  } else {
    byteLength = await assertPngFile(imagePath);
    await copyFile(imagePath, filePath);
  }

  const title = compactText(selectedPrompt?.title, 80) || `${sourceLabel} 封面图`;

  return {
    src: `${GENERATED_ROUTE_PREFIX}${fileName}`,
    title,
    alt: `${title}，${sourceLabel} 生成的封面图`,
    fileName,
    mimeType: "image/png",
    byteLength,
  };
}

export function validateCoverImageRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new CodexApiError("BAD_REQUEST", "请求体必须是 JSON 对象。");
  }

  assertString(payload.persona, "账号人设");
  assertString(payload.keyword, "创作关键词");

  if (!payload.selectedDraft?.title) {
    throw new CodexApiError("BAD_REQUEST", "请先选择一篇文案。");
  }

  if (!payload.selectedPrompt?.prompt && !payload.prompt) {
    throw new CodexApiError("BAD_REQUEST", "请先选择一份封面 Prompt。");
  }
}

export async function runCoverImagegen(payload) {
  const codexPath = resolveCodexCliPath();
  const workDir = await mkdtemp(path.join(tmpdir(), "xhs-g4-imagegen-"));
  const imagePath = path.join(workDir, "image.png");
  const resultPath = path.join(workDir, "result.json");
  const lastMessagePath = path.join(workDir, "last-message.txt");
  const args = [
    "exec",
    "-C",
    repoRoot,
    "--sandbox",
    "workspace-write",
    "-c",
    'approval_policy="on-request"',
    "-c",
    'model_reasoning_effort="low"',
    "--output-last-message",
    lastMessagePath,
    workerPrompt({ payload, imagePath, resultPath }),
  ];
  const startedAt = Date.now();

  try {
    const codexResult = await new Promise((resolve, reject) => {
      const child = spawn(codexPath, args, {
        cwd: repoRoot,
        env: buildCodexProcessEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new CodexApiError("CODEX_TIMEOUT", "Codex CLI imagegen 执行超时，请稍后重试。", 504));
      }, IMAGEGEN_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new CodexApiError("CODEX_UNAVAILABLE", `无法启动 Codex CLI：${error.message}`, 503));
      });

      child.on("close", async (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const durationMs = Date.now() - startedAt;
        let lastMessage = "";
        try {
          lastMessage = await readFile(lastMessagePath, "utf8");
        } catch {
          lastMessage = "";
        }

        if (code !== 0) {
          const details = [stderr.trim(), stdout.trim(), lastMessage.trim()].filter(Boolean).join("\n\n");
          const requiresUpdate = /requires a newer version of Codex|upgrade to the latest app or CLI/i.test(details);
          reject(
            new CodexApiError(
              requiresUpdate ? "CODEX_UPDATE_REQUIRED" : "CODEX_FAILED",
              requiresUpdate
                ? "Codex CLI 版本过旧，无法使用当前图片模型。请先在终端运行 `codex update`，再重新生成封面图。"
                : `Codex CLI imagegen 执行失败，退出码 ${code}。`,
              502,
              details,
            ),
          );
          return;
        }

        resolve({
          commandPreview: commandPreview(args),
          durationMs,
          raw: lastMessage.trim() || stdout.trim(),
          stderr: stderr.trim(),
          stdout: stdout.trim(),
        });
      });
    });

    await readWorkerResult(resultPath, imagePath);
    const image = await publishGeneratedPng({
      imagePath,
      selectedPrompt: payload.selectedPrompt,
    });

    return {
      ...codexResult,
      image,
    };
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

export async function serveGeneratedCover(requestUrl, res, next) {
  if (!requestUrl.pathname.startsWith(GENERATED_ROUTE_PREFIX)) {
    return false;
  }

  const fileName = path.basename(decodeURIComponent(requestUrl.pathname));
  if (!/^cover-\d+-[a-f0-9-]+\.png$/i.test(fileName)) {
    res.statusCode = 404;
    res.end("Not found");
    return true;
  }

  try {
    const png = await readFile(path.join(generatedDir, fileName));
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(png);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }

  return true;
}

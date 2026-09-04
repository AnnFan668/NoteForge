import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexApiError } from "./validation.mjs";
import { buildCodexProcessEnv, resolveCodexCliPath } from "../runtime/toolPaths.mjs";

const TIMEOUT_MS = 180_000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function shouldPassModel(modelName) {
  const value = String(modelName ?? "").trim();
  if (!value) return false;
  if (/codex cli/i.test(value)) return false;
  if (/image cli/i.test(value)) return false;
  if (value.includes("/")) return false;
  if (/\s/.test(value)) return false;
  return true;
}

function buildArgs({ prompt, modelName, outputPath }) {
  const args = [
    "exec",
    "-C",
    repoRoot,
    "-c",
    'model_reasoning_effort="low"',
    "--sandbox",
    "read-only",
    "--output-last-message",
    outputPath,
  ];

  if (shouldPassModel(modelName)) {
    args.push("-m", String(modelName).trim());
  }

  args.push(prompt);
  return args;
}

function commandPreview(args) {
  const safeArgs = args.slice(0, -1).concat("[prompt]");
  return ["codex", ...safeArgs].join(" ");
}

export async function runCodex({ prompt, modelName }) {
  const codexPath = resolveCodexCliPath();
  const workDir = await mkdtemp(path.join(tmpdir(), "xhs-g4-codex-"));
  const outputPath = path.join(workDir, "last-message.txt");
  const args = buildArgs({ prompt, modelName, outputPath });
  const startedAt = Date.now();

  try {
    const result = await new Promise((resolve, reject) => {
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
        reject(new CodexApiError("CODEX_TIMEOUT", "Codex CLI 执行超时，请稍后重试。", 504));
      }, TIMEOUT_MS);

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
        reject(
          new CodexApiError(
            "CODEX_UNAVAILABLE",
            `无法启动 Codex CLI：${error.message}`,
            503,
          ),
        );
      });

      child.on("close", async (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const durationMs = Date.now() - startedAt;
        if (code !== 0) {
          const details = stderr.trim() || stdout.trim();
          const requiresUpdate = /requires a newer version of Codex|upgrade to the latest app or CLI/i.test(details);
          reject(
            new CodexApiError(
              requiresUpdate ? "CODEX_UPDATE_REQUIRED" : "CODEX_FAILED",
              requiresUpdate
                ? "Codex CLI 版本过旧，无法使用当前模型。请先在终端运行 `codex update`，再重新生成。"
                : `Codex CLI 执行失败，退出码 ${code}。`,
              502,
              details,
            ),
          );
          return;
        }

        let raw = "";
        try {
          raw = await readFile(outputPath, "utf8");
        } catch {
          raw = stdout;
        }

        resolve({
          commandPreview: commandPreview(args),
          durationMs,
          raw: raw.trim(),
          stderr: stderr.trim(),
          stdout: stdout.trim(),
        });
      });
    });

    return result;
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

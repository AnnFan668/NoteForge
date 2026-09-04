import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCloudHealthCheck } from "../codex/cloudProvider.mjs";
import { CodexApiError } from "../codex/validation.mjs";
import {
  buildCodexProcessEnv,
  resolveCodexCliPath,
  resolveXhsCliCommand,
} from "../runtime/toolPaths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_OUTPUT_BYTES = 256 * 1024;
const CODEX_PROBE_TIMEOUT_MS = 180_000;

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function processOutput(result) {
  return compact(result.stdout || result.stderr);
}

function runProcess(command, args, timeoutMs, sourceEnv = process.env) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...sourceEnv,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        OUTPUT: "json",
        TERM: "dumb",
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      return Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES ? current : next;
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(Object.assign(new Error(`${command} health check timed out.`), { code: "INTEGRATION_TIMEOUT" }));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - startedAt });
    });
  });
}

function unavailable(target, code, message, fields = {}) {
  return {
    target,
    healthy: false,
    installed: fields.installed ?? false,
    authenticated: fields.authenticated ?? false,
    reachable: fields.reachable ?? false,
    version: fields.version ?? "",
    code,
    message,
    commandPreview: fields.commandPreview ?? "",
    durationMs: fields.durationMs ?? null,
  };
}

async function checkCodex() {
  const command = resolveCodexCliPath();
  const codexEnv = buildCodexProcessEnv();
  let versionResult;
  try {
    versionResult = await runProcess(command, ["--version"], 8_000, codexEnv);
  } catch (error) {
    return unavailable("codex", "CODEX_UNAVAILABLE", `无法启动 Codex CLI：${error.message}`);
  }

  const version = processOutput(versionResult);
  if (versionResult.code !== 0) {
    return unavailable("codex", "CODEX_UNAVAILABLE", "Codex CLI 版本检查失败。", {
      installed: true,
      version,
      commandPreview: "codex --version",
      durationMs: versionResult.durationMs,
    });
  }

  let loginResult;
  try {
    loginResult = await runProcess(command, ["login", "status"], 8_000, codexEnv);
  } catch (error) {
    return unavailable("codex", "CODEX_AUTH_CHECK_FAILED", `Codex 登录状态检查失败：${error.message}`, {
      installed: true,
      version,
    });
  }

  const loginOutput = processOutput(loginResult);
  if (loginResult.code !== 0 || /not logged in|未登录/i.test(loginOutput)) {
    return unavailable("codex", "CODEX_AUTH_REQUIRED", "Codex CLI 已安装但尚未登录，请先在终端运行 codex login。", {
      installed: true,
      version,
      commandPreview: "codex login status",
      durationMs: versionResult.durationMs + loginResult.durationMs,
    });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "mint-codex-health-"));
  const outputPath = path.join(workDir, "last-message.txt");
  try {
    const probe = await runProcess(command, [
      "exec",
      "-C",
      repoRoot,
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--color",
      "never",
      "-c",
      'model_reasoning_effort="low"',
      "--sandbox",
      "read-only",
      "--output-last-message",
      outputPath,
      "Reply with exactly OK and nothing else.",
    ], CODEX_PROBE_TIMEOUT_MS, codexEnv);
    let output = "";
    try {
      output = compact(await readFile(outputPath, "utf8"), 80);
    } catch {
      output = processOutput(probe);
    }

    if (probe.code !== 0 || !output) {
      const probeDetails = `${probe.stderr}\n${probe.stdout}`;
      const runtimeRestricted = /拒绝访问|permission denied|access is denied|readonly database|read-only database/i.test(probeDetails);
      return unavailable(
        "codex",
        runtimeRestricted ? "CODEX_RUNTIME_RESTRICTED" : "CODEX_PROBE_FAILED",
        runtimeRestricted
          ? "Codex CLI 已登录，但当前服务由受限开发环境启动，无法访问 Codex 运行目录。请关闭旧服务并双击 NoteForge.bat。"
          : "Codex CLI 已登录，但真实模型调用失败。",
        {
        installed: true,
        authenticated: true,
        version,
        commandPreview: "codex exec [health probe]",
        durationMs: probe.durationMs,
        },
      );
    }

    const usedHttpFallback = /falling back (?:from WebSockets )?to HTTPS|falling back to HTTP/i.test(probe.stderr);
    return {
      target: "codex",
      healthy: true,
      installed: true,
      authenticated: true,
      reachable: true,
      version,
      code: "",
      message: usedHttpFallback
        ? "Codex CLI 已登录，WebSocket 较慢但已通过 HTTPS 回退完成真实调用。"
        : "Codex CLI 已安装、已登录，真实模型调用成功。",
      commandPreview: "codex exec [health probe]",
      durationMs: versionResult.durationMs + loginResult.durationMs + probe.durationMs,
    };
  } catch (error) {
    const timedOut = error.code === "INTEGRATION_TIMEOUT";
    return unavailable(
      "codex",
      timedOut ? "CODEX_PROBE_TIMEOUT" : (error.code || "CODEX_PROBE_FAILED"),
      timedOut
        ? "Codex 已登录，但真实调用在 180 秒内仍未完成。请检查代理是否支持 OpenAI HTTPS/WebSocket。"
        : `Codex 真实模型调用失败：${error.message}`,
      {
      installed: true,
      authenticated: true,
      version,
      commandPreview: "codex exec [health probe]",
      },
    );
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

function parseJson(value) {
  try {
    return JSON.parse(String(value ?? "").trim());
  } catch {
    return null;
  }
}

async function checkXhs() {
  const command = resolveXhsCliCommand();
  let versionResult;
  try {
    versionResult = await runProcess(command, ["--version"], 8_000);
  } catch (error) {
    return unavailable("xhs", "XHS_CLI_UNAVAILABLE", "xiaohongshu-cli 尚未安装。请先运行 Setup-Xhs.bat。");
  }

  const version = processOutput(versionResult);
  if (versionResult.code !== 0) {
    return unavailable("xhs", "XHS_CLI_UNAVAILABLE", "xiaohongshu-cli 版本检查失败。", {
      installed: true,
      version,
      commandPreview: "xhs --version",
      durationMs: versionResult.durationMs,
    });
  }

  let statusResult;
  try {
    statusResult = await runProcess(command, ["--cookie-source", "none", "status", "--json"], 25_000);
  } catch (error) {
    return unavailable("xhs", error.code || "XHS_AUTH_CHECK_FAILED", `小红书登录状态检查失败：${error.message}`, {
      installed: true,
      version,
    });
  }

  const envelope = parseJson(statusResult.stdout);
  const authenticated = statusResult.code === 0 && envelope?.ok === true && envelope?.data?.authenticated === true;
  if (!authenticated) {
    const upstreamCode = compact(envelope?.error?.code, 80);
    const rawDetails = statusResult.stderr || statusResult.stdout;
    const profileUnavailable = /PermissionError|access.*denied|拒绝访问/i.test(rawDetails);
    const code = profileUnavailable
      ? "XHS_PROFILE_UNAVAILABLE"
      : upstreamCode === "verification_required"
        ? "XHS_VERIFY_REQUIRED"
        : "XHS_AUTH_REQUIRED";
    const message = profileUnavailable
      ? "xiaohongshu-cli 已安装，但无法访问用户登录目录。请在普通终端中运行 XhsLogin.bat。"
      : compact(envelope?.error?.message, 240) || "xiaohongshu-cli 已安装但尚未登录，请运行 XhsLogin.bat。";
    return unavailable("xhs", code, message, {
      installed: true,
      version,
      commandPreview: "xhs --cookie-source none status --json",
      durationMs: statusResult.durationMs,
    });
  }

  return {
    target: "xhs",
    healthy: true,
    installed: true,
    authenticated: true,
    reachable: true,
    version,
    code: "",
    message: "xiaohongshu-cli 已安装，账号登录状态有效。",
    commandPreview: "xhs --cookie-source none status --json",
    durationMs: versionResult.durationMs + statusResult.durationMs,
  };
}

async function checkCloudText(payload) {
  try {
    const result = await runCloudHealthCheck(payload);
    return {
      target: "cloud-text",
      healthy: true,
      installed: true,
      authenticated: true,
      reachable: true,
      version: result.modelName,
      code: "",
      message: `${result.modelName} API 鉴权和真实文本调用成功。`,
      commandPreview: result.commandPreview,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return unavailable("cloud-text", error?.code || "API_HEALTH_FAILED", error?.message || "云端文本 API 检测失败。", {
      installed: true,
      authenticated: false,
      reachable: error instanceof CodexApiError && error.code === "API_HTTP_ERROR",
      version: String(payload?.modelName ?? "").trim(),
      commandPreview: "POST /chat/completions",
    });
  }
}

export async function checkIntegration(payload = {}) {
  const target = String(payload.target ?? "").trim();
  if (target === "codex") return checkCodex();
  if (target === "xhs") return checkXhs();
  if (target === "cloud-text") return checkCloudText(payload);
  throw new CodexApiError("BAD_REQUEST", "不支持的集成检测目标。", 400);
}

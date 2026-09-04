import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodex } from "../codex/runCodex.mjs";
import { CodexApiError } from "../codex/validation.mjs";
import { buildCodexProcessEnv, resolveCodexCliPath } from "../runtime/toolPaths.mjs";

const TEXT_TIMEOUT_MS = 180_000;
const DETECT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const BUILTIN_CLIS = [
  {
    id: "codex",
    label: "Codex CLI",
    description: "Codex 原生非交互模式",
    capabilities: { text: true, image: true },
    command: () => resolveCodexCliPath(),
    commandPreview: "codex exec ...",
  },
  {
    id: "kimi",
    label: "Kimi CLI",
    description: "Kimi Code CLI stream-json 模式",
    capabilities: { text: true, image: false },
    command: () => process.env.KIMI_CLI_PATH || "kimi",
    commandPreview: "kimi --prompt ... --output-format stream-json",
  },
  {
    id: "claude",
    label: "Claude Code",
    description: "Claude Code 非交互 JSON 模式",
    capabilities: { text: true, image: false },
    command: () => process.env.CLAUDE_CLI_PATH || "claude",
    commandPreview: "claude --print ... --output-format json",
  },
];

function compactDetails(value, maxLength = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validateCommand(command) {
  const value = String(command ?? "").trim();
  if (!value || value.length > 500 || value.includes("\0")) {
    throw new CodexApiError("LOCAL_CLI_CONFIG_INVALID", "请填写合法的本机 CLI 命令或绝对路径。", 400);
  }

  if (!path.isAbsolute(value) && !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new CodexApiError(
      "LOCAL_CLI_CONFIG_INVALID",
      "CLI 命令请填写 PATH 中的命令名，或填写可执行文件绝对路径。",
      400,
    );
  }

  return value;
}

function displayCommand(command) {
  return path.isAbsolute(command) ? path.basename(command) : command;
}

function modelArg(modelName) {
  const value = String(modelName ?? "").trim();
  if (!value) return [];
  return ["--model", value];
}

function parseAssistantContent(stdout) {
  let lastAssistantContent = "";

  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.role !== "assistant") continue;
      if (typeof event.content === "string") {
        lastAssistantContent = event.content;
        continue;
      }
      if (Array.isArray(event.content)) {
        const text = event.content
          .map((part) => (typeof part === "string" ? part : part?.text))
          .filter(Boolean)
          .join("\n");
        if (text) lastAssistantContent = text;
      }
    } catch {
      // Ignore non-JSON progress lines. The final validation reports malformed output.
    }
  }

  return lastAssistantContent.trim();
}

async function spawnAndCollect(command, args, { timeoutMs, errorPrefix, processEnv = process.env }) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...processEnv, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const appendOutput = (target, chunk) => {
      const next = target + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill("SIGTERM");
          reject(
            new CodexApiError(
              "LOCAL_CLI_OUTPUT_TOO_LARGE",
              `${errorPrefix} 输出过大，已停止本次执行。`,
              502,
            ),
          );
        }
        return target;
      }
      return next;
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new CodexApiError("LOCAL_CLI_TIMEOUT", `${errorPrefix} 执行超时，请稍后重试。`, 504));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new CodexApiError(
          "LOCAL_CLI_UNAVAILABLE",
          `无法启动 ${errorPrefix}：${error.message}`,
          503,
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (code !== 0) {
        reject(
          new CodexApiError(
            "LOCAL_CLI_FAILED",
            `${errorPrefix} 执行失败，退出码 ${code}。`,
            502,
            compactDetails(stderr || stdout),
          ),
        );
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), durationMs });
    });
  });
}

async function runPrintProtocolCli({ command, prompt, modelName, label }) {
  const args = [
    ...modelArg(modelName),
    "--prompt",
    prompt,
    "--output-format",
    "stream-json",
  ];
  const result = await spawnAndCollect(command, args, {
    timeoutMs: TEXT_TIMEOUT_MS,
    errorPrefix: label,
  });
  const raw = parseAssistantContent(result.stdout);
  if (!raw) {
    throw new CodexApiError(
      "LOCAL_CLI_BAD_OUTPUT",
      `${label} 没有返回可解析的 Assistant 内容。`,
      502,
      compactDetails(result.stdout || result.stderr),
    );
  }

  return {
    ...result,
    raw,
    commandPreview: `${displayCommand(command)}${modelArg(modelName).length ? " --model [model]" : ""} --prompt [prompt] --output-format stream-json`,
  };
}

function parseClaudeResult(stdout, label) {
  let payload;
  try {
    payload = JSON.parse(String(stdout ?? "").trim());
  } catch {
    throw new CodexApiError(
      "LOCAL_CLI_BAD_OUTPUT",
      `${label} 没有返回合法的 JSON 结果。`,
      502,
      compactDetails(stdout),
    );
  }

  const raw = typeof payload?.result === "string"
    ? payload.result.trim()
    : payload?.structured_output && typeof payload.structured_output === "object"
      ? JSON.stringify(payload.structured_output)
      : "";

  if (payload?.is_error || !raw) {
    throw new CodexApiError(
      payload?.is_error ? "LOCAL_CLI_FAILED" : "LOCAL_CLI_BAD_OUTPUT",
      payload?.is_error
        ? `${label} 返回了执行错误。`
        : `${label} 没有返回可解析的 result 内容。`,
      502,
      compactDetails(payload?.result || stdout),
    );
  }

  return raw;
}

async function runClaudePrintCli({ command, prompt, modelName, label }) {
  const args = [
    ...modelArg(modelName),
    "--print",
    prompt,
    "--output-format",
    "json",
    "--safe-mode",
    "--tools",
    "",
    "--no-session-persistence",
  ];
  const result = await spawnAndCollect(command, args, {
    timeoutMs: TEXT_TIMEOUT_MS,
    errorPrefix: label,
  });

  return {
    ...result,
    raw: parseClaudeResult(result.stdout, label),
    commandPreview: `${displayCommand(command)}${modelArg(modelName).length ? " --model [model]" : ""} --print [prompt] --output-format json --safe-mode --tools [disabled] --no-session-persistence`,
  };
}

function getSelection(payload = {}) {
  const cliId = String(payload.cliId ?? "codex").trim() || "codex";
  if (cliId === "custom") {
    const command = validateCommand(payload.cliCommand);
    return {
      id: "custom",
      label: `规范 CLI（${displayCommand(command)}）`,
      description: "兼容 Mint Atelier print protocol",
      capabilities: { text: true, image: false },
      command,
      commandPreview: `${displayCommand(command)} --prompt ... --output-format stream-json`,
    };
  }

  const adapter = BUILTIN_CLIS.find((item) => item.id === cliId);
  if (!adapter) {
    throw new CodexApiError("LOCAL_CLI_CONFIG_INVALID", `不支持的本地 CLI：${cliId}。`, 400);
  }
  return { ...adapter, command: adapter.command() };
}

export function localCliSummary(payload = {}) {
  const selection = getSelection(payload);
  return {
    id: selection.id,
    label: selection.label,
    capabilities: selection.capabilities,
    commandPreview: selection.commandPreview,
  };
}

export async function runLocalTextCli({ prompt, modelName, cliId, cliCommand }) {
  const selection = getSelection({ cliId, cliCommand });
  if (!selection.capabilities.text) {
    throw new CodexApiError("LOCAL_CLI_CAPABILITY_UNSUPPORTED", `${selection.label} 不支持文本生成。`, 400);
  }

  if (selection.id === "codex") {
    return runCodex({ prompt, modelName });
  }

  if (selection.id === "claude") {
    return runClaudePrintCli({
      command: selection.command,
      prompt,
      modelName,
      label: selection.label,
    });
  }

  return runPrintProtocolCli({
    command: selection.command,
    prompt,
    modelName,
    label: selection.label,
  });
}

async function detectOne(adapter) {
  const command = adapter.command();
  try {
    const result = await spawnAndCollect(command, ["--version"], {
      timeoutMs: DETECT_TIMEOUT_MS,
      errorPrefix: adapter.label,
      processEnv: adapter.id === "codex" ? buildCodexProcessEnv() : process.env,
    });
    return {
      id: adapter.id,
      label: adapter.label,
      description: adapter.description,
      capabilities: adapter.capabilities,
      available: true,
      version: compactDetails(result.stdout || result.stderr, 120),
      commandPreview: adapter.commandPreview,
    };
  } catch (error) {
    return {
      id: adapter.id,
      label: adapter.label,
      description: adapter.description,
      capabilities: adapter.capabilities,
      available: false,
      version: "",
      error: error?.message || `${adapter.label}不可用。`,
      commandPreview: adapter.commandPreview,
    };
  }
}

export async function detectLocalClis({ customCommand } = {}) {
  const detected = await Promise.all(BUILTIN_CLIS.map(detectOne));
  if (String(customCommand ?? "").trim()) {
    const command = validateCommand(customCommand);
    detected.push(
      await detectOne({
        id: "custom",
        label: `规范 CLI（${displayCommand(command)}）`,
        description: "兼容 Mint Atelier print protocol",
        capabilities: { text: true, image: false },
        command: () => command,
        commandPreview: `${displayCommand(command)} --prompt ... --output-format stream-json`,
      }),
    );
  }
  return detected;
}

export function assertLocalImageCli(payload = {}) {
  const selection = getSelection(payload);
  if (!selection.capabilities.image || selection.id !== "codex") {
    throw new CodexApiError(
      "LOCAL_CLI_CAPABILITY_UNSUPPORTED",
      `${selection.label} 未声明本地图片生成能力，请选择 Codex CLI 或云端图片 API。`,
      400,
    );
  }
  return selection;
}

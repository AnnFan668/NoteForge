import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function newestExistingFile(candidates) {
  return candidates
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => {
      try {
        return { candidate, modifiedAt: statSync(candidate).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.candidate || "";
}

export function resolveXhsCliCommand(sourceEnv = process.env, platform = process.platform) {
  if (sourceEnv.XHS_CLI_COMMAND) return sourceEnv.XHS_CLI_COMMAND;
  const bundledPath = platform === "win32"
    ? path.resolve(repoRoot, ".tools", "xhs", "Scripts", "xhs.exe")
    : path.resolve(repoRoot, ".tools", "xhs", "bin", "xhs");
  return existsSync(bundledPath) ? bundledPath : "xhs";
}

export function resolveCodexCliPath(sourceEnv = process.env, platform = process.platform) {
  if (sourceEnv.CODEX_CLI_PATH) return sourceEnv.CODEX_CLI_PATH;
  if (platform !== "win32" || !sourceEnv.LOCALAPPDATA) return "codex";

  const binDir = path.resolve(sourceEnv.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  if (!existsSync(binDir)) return "codex";

  const candidates = [path.resolve(binDir, "codex.exe")];
  try {
    for (const entry of readdirSync(binDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.resolve(binDir, entry.name, "codex.exe"));
      }
    }
  } catch {
    return newestExistingFile(candidates) || "codex";
  }

  return newestExistingFile(candidates) || "codex";
}

export function resolveCodexHome(sourceEnv = process.env) {
  return sourceEnv.CODEX_HOME || path.resolve(homedir(), ".codex");
}

export function buildCodexProcessEnv(sourceEnv = process.env) {
  return {
    ...sourceEnv,
    CODEX_HOME: resolveCodexHome(sourceEnv),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
}

#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveCodexCliPath,
  resolveCodexHome,
  resolveXhsCliCommand,
} from "../server/runtime/toolPaths.mjs";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = "52880";
const url = `http://${host}:${port}`;
const npmCliPath = process.platform === "win32"
  ? resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : null;
const npmCommand = npmCliPath && existsSync(npmCliPath) ? process.execPath : "npm";
const npmArgsPrefix = npmCliPath && existsSync(npmCliPath) ? [npmCliPath] : [];
const npmCacheDir = resolve(projectDir, ".npm-cache");
const bundledXhsPath = resolveXhsCliCommand();
const codexDesktopCliPath = resolveCodexCliPath();
const useDevServer = process.argv.includes("--dev");
const npmScript = useDevServer ? "dev:fixed" : "deploy:local";

function projectEnv() {
  const env = { ...process.env, npm_config_cache: npmCacheDir };
  if (!env.XHS_CLI_COMMAND && bundledXhsPath !== "xhs") {
    env.XHS_CLI_COMMAND = bundledXhsPath;
  }
  if (!env.CODEX_CLI_PATH && codexDesktopCliPath !== "codex") {
    env.CODEX_CLI_PATH = codexDesktopCliPath;
  }
  if (!env.CODEX_HOME) {
    env.CODEX_HOME = resolveCodexHome(env);
  }
  return env;
}

function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: projectDir,
    stdio: options.stdio ?? "inherit",
    env: projectEnv(),
    shell: false,
  });
}

function runNpm(args, options = {}) {
  return run(npmCommand, [...npmArgsPrefix, ...args], options);
}

function installDependenciesIfNeeded() {
  const viteEntry = resolve(projectDir, "node_modules", "vite", "bin", "vite.js");
  const reactPluginEntry = resolve(projectDir, "node_modules", "@vitejs", "plugin-react", "dist", "index.js");
  if (existsSync(viteEntry) && existsSync(reactPluginEntry)) return;

  console.log("Project dependencies are missing or incomplete. Installing dependencies...");
  const result = spawnSync(npmCommand, [...npmArgsPrefix, "install"], {
    cwd: projectDir,
    stdio: "inherit",
    env: projectEnv(),
    shell: false,
  });

  if (result.error) {
    console.error(`Could not start npm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function openBrowser() {
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (process.platform === "win32") {
    const edgeCandidates = [
      process.env["PROGRAMFILES(X86)"] && resolve(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    ].filter(Boolean);
    const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));
    if (edgePath) {
      console.log("Opening in Microsoft Edge");
      spawn(edgePath, [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }

    console.log("Microsoft Edge was not found; opening the Windows default browser");
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function waitForServer() {
  const startedAt = Date.now();
  const timeoutMs = 30_000;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return true;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  return false;
}

installDependenciesIfNeeded();

console.log("Starting Mint Atelier");
console.log(`Project: ${projectDir}`);
console.log(`Fixed URL: ${url}`);
console.log(`Mode: ${useDevServer ? "development server" : "build and local preview"}`);
console.log(`XHS CLI: ${bundledXhsPath}`);
console.log(`Codex CLI: ${codexDesktopCliPath}`);
console.log("Keep this window open while using the app.");
console.log("Press Ctrl+C to stop the local server.");
console.log("");

const server = runNpm(["run", npmScript], {
  stdio: ["inherit", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

server.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

let opened = false;
waitForServer().then((ready) => {
  if (!ready || opened || server.exitCode !== null) return;
  opened = true;
  console.log(`Opening ${url}`);
  openBrowser();
});

function stopServer(signal) {
  if (server.exitCode === null) {
    server.kill(signal);
  }
}

process.on("SIGINT", () => stopServer("SIGINT"));
process.on("SIGTERM", () => stopServer("SIGTERM"));

server.on("exit", (code, signal) => {
  if (!opened && !signal && code !== 0) {
    console.log("");
    console.log(`Could not start the fixed server at ${url}.`);
    console.log(`Check whether port ${port} is already in use.`);
  }
  if (signal === "SIGINT") process.exit(130);
  if (signal === "SIGTERM") process.exit(143);
  process.exit(code ?? 0);
});

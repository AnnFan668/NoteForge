#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = resolve(projectDir, ".tools", "xhs");
const venvPython = process.platform === "win32"
  ? resolve(venvDir, "Scripts", "python.exe")
  : resolve(venvDir, "bin", "python");
const xhsCommand = process.platform === "win32"
  ? resolve(venvDir, "Scripts", "xhs.exe")
  : resolve(venvDir, "bin", "xhs");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findPython() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []]]
    : [["python3", []], ["python", []]];

  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, "--version"], {
      cwd: projectDir,
      encoding: "utf8",
      shell: false,
    });
    if (result.status === 0) return { command, prefix };
  }

  console.error("Python 3 was not found. Install Python 3.8 or newer, then run this setup again.");
  process.exit(1);
}

console.log("Installing xiaohongshu-cli into the project-isolated environment:");
console.log(venvDir);

if (!existsSync(venvPython)) {
  const python = findPython();
  run(python.command, [...python.prefix, "-m", "venv", venvDir]);
}

run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython, ["-m", "pip", "install", "--upgrade", "xiaohongshu-cli"]);
run(xhsCommand, ["--version"]);

console.log("");
console.log("Installation complete. Login is a separate, user-confirmed step.");
console.log("XhsLogin.bat will show a terminal QR code if the optional Camoufox browser is unavailable.");
console.log(process.platform === "win32"
  ? "Double-click XhsLogin.bat, or run: .\\.tools\\xhs\\Scripts\\xhs.exe login --qrcode"
  : "Run: ./.tools/xhs/bin/xhs login --qrcode");

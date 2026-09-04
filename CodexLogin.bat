@echo off
setlocal
cd /d "%~dp0"

chcp 65001 >nul
title Mint Atelier - Codex Login

set "CODEX_EXE="
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -Command "$root = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'; Get-ChildItem -LiteralPath $root -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "CODEX_EXE=%%I"

if not defined CODEX_EXE (
  echo Codex CLI was not found in the Codex desktop app.
  echo Open or update the Codex desktop app, then run this file again.
  echo.
  pause
  exit /b 1
)

echo Codex CLI found:
echo %CODEX_EXE%
echo.
echo A browser window will open. Sign in with the same ChatGPT account you want Codex to use.
echo Keep this window open until the browser returns to Codex.
echo.
"%CODEX_EXE%" login
if errorlevel 1 (
  echo.
  echo Codex login did not complete. You can retry with device-code login:
  echo "%CODEX_EXE%" login --device-auth
  echo.
  pause
  exit /b 1
)

echo.
echo Verifying Codex authentication...
"%CODEX_EXE%" login status
echo.
echo Login is complete. Restart NoteForge, then click the Codex CLI check button.
echo.
pause

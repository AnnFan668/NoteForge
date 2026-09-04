@echo off
setlocal

set "PROJECT_DIR=%~dp0"

cd /d "%PROJECT_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node scripts\start-fixed.mjs

echo.
pause

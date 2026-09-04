@echo off
setlocal
cd /d "%~dp0"

chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
title Mint Atelier - Xiaohongshu Browser Login

set "XHS_EXE=%~dp0.tools\xhs\Scripts\xhs.exe"
if not exist "%XHS_EXE%" (
  echo xiaohongshu-cli is not installed in this project.
  echo Please run Setup-Xhs.bat first.
  echo.
  pause
  exit /b 1
)

echo Step 1 of 3: Sign in to Xiaohongshu in the browser that is about to open.
echo Wait until the website shows your own avatar or profile.
echo.
start "" "https://www.xiaohongshu.com/explore"

echo Step 2 of 3: After the website login succeeds, CLOSE ALL Chrome/Edge windows.
echo Closing the browser lets xhs safely read its local cookie database.
echo Then return here and press any key.
echo.
pause

echo.
echo Step 3 of 3: Importing the browser login into xhs...
"%XHS_EXE%" login --cookie-source auto --json
if errorlevel 1 (
  echo.
  echo Cookie import failed. Confirm the Xiaohongshu WEBSITE was logged in,
  echo close every browser window, and run XhsLogin.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo Verifying the saved xhs session...
"%XHS_EXE%" --cookie-source none status --json
if errorlevel 1 (
  echo.
  echo Cookies were imported, but Xiaohongshu did not accept the saved session.
  echo Please run XhsLogin.bat again and verify the web login first.
  echo.
  pause
  exit /b 1
)

echo.
echo Login is complete. You can now return to Mint Atelier and search.
echo.
pause

@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer once, then launch again.
  pause
  exit /b 1
)
if not exist dist\index.html (
  echo Build missing. Run FIRST_TIME_SETUP_WINDOWS.bat.
  pause
  exit /b 1
)
node server.mjs --open
if errorlevel 1 pause

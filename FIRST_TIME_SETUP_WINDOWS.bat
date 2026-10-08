@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 22.12 or newer is required for first-time setup.
  echo Install Node.js, reopen this folder, and run this file again.
  echo.
  pause
  exit /b 1
)
echo.
echo ==========================================
echo   MotionForge Local 2 - First Time Setup
echo ==========================================
echo.
echo This setup needs internet only to download the local app dependencies.
echo After build completes, start_windows.bat works offline.
echo.
call npm ci
if errorlevel 1 (
  echo.
  echo npm install failed. Check internet and retry.
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed. See the error above.
  pause
  exit /b 1
)
echo.
echo Setup complete.
echo From now on, double-click start_windows.bat.
echo.
pause

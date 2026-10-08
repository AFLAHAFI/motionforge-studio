@echo off
setlocal
cd /d "%~dp0"
echo Installing the optional local native FFmpeg engine. Internet is needed for this setup.
call npm install --save-optional ffmpeg-static@5.2.0
if errorlevel 1 goto failed
node scripts/setup-native.mjs
if errorlevel 1 goto failed
echo Native setup complete. Run start_windows.bat.
pause
exit /b 0
:failed
echo Native setup could not finish. Browser export remains available.
pause
exit /b 1

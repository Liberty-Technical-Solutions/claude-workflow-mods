@echo off
cd /d "%~dp0"
echo Removing the Claude workflow mods...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Remove
echo.
echo Done. Close Claude and open it again.
pause

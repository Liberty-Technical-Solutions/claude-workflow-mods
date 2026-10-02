@echo off
cd /d "%~dp0"
echo Installing the Claude workflow mods installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Installer
echo.
echo Next: close Claude completely, open it again, start a NEW session, type /mods and press Enter.
pause

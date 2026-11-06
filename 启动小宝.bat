@echo off
rem Xiaobao Table launcher: start local server + open browser.
rem Keep this file ASCII-only. %~dp0 expands to this folder at runtime.
cd /d "%~dp0"
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -root "%~dp0." -port 8765
timeout /t 2 /nobreak >nul
start "" http://localhost:8765/
exit

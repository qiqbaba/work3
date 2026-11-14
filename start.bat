@echo off
REM ============================================================
REM  Office toolbox LAN server (Windows one-click starter)
REM  Other devices on the same Wi-Fi can open the toolbox in a
REM  browser, install the offline app and receive updates whenever
REM  the source changes. Requires Node.js >= 20.11, no npm install.
REM  The default browser opens automatically once the server is ready.
REM  Usage: start.bat [port]   (default 8080)
REM ============================================================
cd /d "%~dp0"
chcp 65001 >nul
set "PORT=8080"
if not "%~1"=="" set "PORT=%~1"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node.js 20.11 or newer.
  pause
  exit /b 1
)

node server.js --port %PORT% --open
echo.
echo Server stopped.
pause

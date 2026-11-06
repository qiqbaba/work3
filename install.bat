@echo off
REM ============================================================
REM  Office toolbox one-click LAN installer (Windows)
REM  The SERVER URL below is auto-injected when this file is
REM  downloaded from the web UI ("Download installer" button).
REM  Every downloaded PowerShell component is verified against the
REM  SHA256 recorded in version.json BEFORE it is executed.
REM  No admin rights required.
REM ============================================================
set "SERVER=http://REPLACE_ME:8000"
set "DEST=%LOCALAPPDATA%\OfficeToolbox"

echo [1/3] Preparing %DEST% ...
if not exist "%DEST%" mkdir "%DEST%"

echo [2/3] Downloading and verifying installer components ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $s='%SERVER%'; $d='%DEST%'; $m=Invoke-RestMethod -Uri ($s+'/version.json?t='+[DateTime]::Now.Ticks) -TimeoutSec 15; foreach($n in @('install.ps1','update.ps1')){ Invoke-WebRequest -Uri ($s+'/'+$n) -OutFile (Join-Path $d $n) -UseBasicParsing -TimeoutSec 30; $h=(Get-FileHash -LiteralPath (Join-Path $d $n) -Algorithm SHA256).Hash.ToLowerInvariant(); $p=$m.scripts.PSObject.Properties[$n]; if(-not $p -or $h -ne [string]$p.Value){ throw ('integrity check failed for '+$n) } }"
if errorlevel 1 goto :fail

echo [3/3] Installing ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\install.ps1" -ServerUrl "%SERVER%"
if errorlevel 1 goto :fail

echo.
echo Installation finished. A desktop shortcut has been created.
echo The app now works fully offline and updates itself in the background.
pause
exit /b 0

:fail
echo.
echo Installation failed. Check the server address, network, and version.json, then retry.
pause
exit /b 1

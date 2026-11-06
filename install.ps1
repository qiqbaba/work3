# Office toolbox LAN local installer (ASCII only, safe for Windows PowerShell 5.1)
# Downloaded to %LOCALAPPDATA%\OfficeToolbox\install.ps1 by install.bat, then executed
# with -ServerUrl "<server>". install.bat verifies this file against the SHA256
# in version.json before running it; this script verifies the HTML payload and
# update.ps1 the same way.
#
# Everything this script does is listed below (nothing hidden):
#   [1/5] Read version.json, verify and install office-toolbox-offline.html (with backup).
#   [2/5] Write config.json (server URL) and version.txt for the updater.
#   [3/5] Register the officetoolbox:// URL protocol for the current user (HKCU only).
#   [4/5] Create a desktop shortcut that opens the app (fully offline).
#   [5/5] Register a per-user scheduled task that checks for updates at logon
#         and once a day by running update.ps1 (best-effort, offline-safe).
#
# No admin rights required. All registry/task changes are per-user (HKCU).

param([Parameter(Mandatory = $true)][string]$ServerUrl)

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlName = 'office-toolbox-offline.html'
$htmlPath = Join-Path $dir $htmlName
$bakPath = Join-Path $dir ($htmlName + '.bak')
$configPath = Join-Path $dir 'config.json'
$versionPath = Join-Path $dir 'version.txt'
$updatePs1 = Join-Path $dir 'update.ps1'
$server = $ServerUrl.TrimEnd('/')

function Get-Sha256([string]$p) {
    return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Host allowlist: only a plain http(s) origin is accepted.
if ($server -notmatch '^https?://[A-Za-z0-9.\-]+(:\d+)?$') {
    Write-Host ('Invalid server origin: ' + $server)
    exit 1
}

Write-Host '[1/5] Reading manifest and verifying app package ...'
$remoteVersion = ''
try {
    $manifest = Invoke-RestMethod -Uri "$server/version.json" -TimeoutSec 15
    $remoteVersion = [string]$manifest.version
    $remoteSha = [string]$manifest.sha256
    $remoteSize = [int]$manifest.size
    $manifestFile = [string]$manifest.file
    if ($manifestFile -ne $htmlName) { throw 'unexpected payload name in version.json' }
    if ($remoteSha -notmatch '^[0-9a-f]{64}$' -or $remoteSize -le 0) {
        throw 'version.json has no valid sha256/size'
    }

    # Re-verify the updater that install.bat downloaded.
    $expectedUpdater = ''
    if ($manifest.scripts -and $manifest.scripts.PSObject.Properties['update.ps1']) {
        $expectedUpdater = [string]$manifest.scripts.PSObject.Properties['update.ps1'].Value
    }
    if ($expectedUpdater -notmatch '^[0-9a-f]{64}$') { throw 'manifest lacks update.ps1 hash' }
    if (-not (Test-Path $updatePs1)) { throw 'update.ps1 is missing' }
    if ((Get-Sha256 $updatePs1) -ne $expectedUpdater) { throw 'update.ps1 integrity check failed' }

    $tmp = Join-Path $env:TEMP ('office_toolbox_app_' + [DateTime]::Now.Ticks + '.html')
    Invoke-WebRequest -Uri "$server/$htmlName" -OutFile $tmp -UseBasicParsing -TimeoutSec 120
    if ((Get-Sha256 $tmp) -ne $remoteSha -or (Get-Item $tmp).Length -ne $remoteSize) {
        throw 'app package integrity check failed'
    }
    # Keep a backup so a failed install can be restored manually.
    if (Test-Path $htmlPath) { Copy-Item -Path $htmlPath -Destination $bakPath -Force }
    Move-Item -Path $tmp -Destination $htmlPath -Force
} catch {
    Write-Host ('Install failed: ' + $_.Exception.Message)
    exit 1
}

Write-Host '[2/5] Writing local config ...'
$cfg = [ordered]@{ server = $server } | ConvertTo-Json
Set-Content -Path $configPath -Value $cfg -Encoding UTF8
if ($remoteVersion) {
    Set-Content -Path $versionPath -Value $remoteVersion -Encoding ASCII
}

Write-Host '[3/5] Registering officetoolbox:// protocol (current user) ...'
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
try {
    $cmd = '"' + $psExe + '" -NoProfile -ExecutionPolicy Bypass -File "' + $updatePs1 + '" -Launch "%1"'
    # pdf2png:// is kept as an alias so pages built before the rename can still
    # open installations created by an older installer.
    foreach ($scheme in @('officetoolbox', 'pdf2png')) {
        $protoKey = 'HKCU:\Software\Classes\' + $scheme
        Remove-Item -Path $protoKey -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -Path $protoKey -Force | Out-Null
        Set-ItemProperty -Path $protoKey -Name '(default)' -Value 'URL:Office Toolbox'
        Set-ItemProperty -Path $protoKey -Name 'URL Protocol' -Value ''
        $cmdKey = Join-Path $protoKey 'shell\open\command'
        New-Item -Path $cmdKey -Force | Out-Null
        # Scripts are hash-verified against version.json before execution, so the
        # local Bypass scope is limited to these two files in the install folder.
        Set-ItemProperty -Path $cmdKey -Name '(default)' -Value $cmd
    }
} catch {
    Write-Host ('Protocol registration failed: ' + $_.Exception.Message)
    exit 1
}

Write-Host '[4/5] Creating desktop shortcut ...'
try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $ws = New-Object -ComObject WScript.Shell
    $oldLnk = Join-Path $desktop 'PDF-to-PNG Offline Toolbox.lnk'
    if (Test-Path $oldLnk) { Remove-Item -LiteralPath $oldLnk -Force -ErrorAction SilentlyContinue }
    $lnkPath = Join-Path $desktop 'Office Toolbox.lnk'
    $lnk = $ws.CreateShortcut($lnkPath)
    $lnk.TargetPath = $htmlPath
    $lnk.WorkingDirectory = $dir
    $lnk.Description = 'Offline office toolbox (local install)'
    $lnk.Save()
} catch {
    Write-Host ('Shortcut creation failed: ' + $_.Exception.Message)
    exit 1
}

Write-Host '[5/5] Registering silent update task (logon + daily) ...'
try {
    # Remove the task created by older installers so only one updater runs.
    try { Unregister-ScheduledTask -TaskName 'PdfToPngUpdateCheck' -Confirm:$false -ErrorAction SilentlyContinue } catch { }
    $action = New-ScheduledTaskAction -Execute $psExe -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $updatePs1 + '"') -WorkingDirectory $dir
    $trigLogon = New-ScheduledTaskTrigger -AtLogOn
    $trigDaily = New-ScheduledTaskTrigger -Daily -At 9am
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'OfficeToolboxUpdateCheck' -Action $action -Trigger $trigLogon, $trigDaily -Settings $settings -Force | Out-Null
} catch {
    Write-Host ('Update task registration failed: ' + $_.Exception.Message)
    exit 1
}

Write-Host ''
Write-Host 'Local install complete. The app works fully offline and will'
Write-Host 'check for updates silently at logon and once a day.'
exit 0

# Office toolbox local updater (PowerShell 5.1 compatible, ASCII only)
# Deployed to %LOCALAPPDATA%\OfficeToolbox\update.ps1 by install.ps1.
#
# Modes:
#   (no args)      - background update check, used by the scheduled task.
#   -Launch <url>  - open the local app first (officetoolbox://open), then check updates.
#
# Trust model: version.json is the manifest. Every downloaded file (including
# this script's own replacement) is verified against its SHA256 in the manifest
# before it replaces anything. A failed update restores the previous HTML.
# When the LAN server is unreachable the script exits silently and the app
# keeps working fully offline.

param([string]$Launch)

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlPath = Join-Path $dir 'office-toolbox-offline.html'
$bakPath = Join-Path $dir 'office-toolbox-offline.html.bak'
$configPath = Join-Path $dir 'config.json'
$versionPath = Join-Path $dir 'version.txt'
$logPath = Join-Path $dir 'update.log'

function Write-Log([string]$msg) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    try { Add-Content -Path $logPath -Value $line -Encoding UTF8 } catch { }
    try {
        $lines = Get-Content $logPath -ErrorAction Stop
        if ($lines.Count -gt 200) {
            $lines | Select-Object -Last 200 | Set-Content $logPath -Encoding UTF8
        }
    } catch { }
}

function Get-Sha256([string]$p) {
    return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Restore-Backup {
    if (Test-Path $bakPath) {
        try {
            Move-Item -Path $bakPath -Destination $htmlPath -Force
            Write-Log 'rollback: previous html restored'
        } catch {
            Write-Log "rollback FAILED: $($_.Exception.Message)"
        }
    }
}

# 1. Launch mode: open the app immediately (works fully offline, zero wait).
if ($Launch -and $Launch.ToLower().Contains('open')) {
    if (Test-Path $htmlPath) {
        try { Start-Process $htmlPath } catch { Write-Log "launch failed: $($_.Exception.Message)" }
    }
}

# 2. Check the LAN server for a newer version (silent skip on failure).
try {
    if (-not (Test-Path $configPath)) { exit 0 }
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    $server = ([string]$cfg.server).TrimEnd('/')
    if (-not $server) { exit 0 }

    # Host allowlist: only the plain origin stored at install time is usable.
    # Never follow a URL supplied by the remote manifest itself.
    if ($server -notmatch '^https?://[A-Za-z0-9.\-]+(:\d+)?$') {
        Write-Log "refusing invalid server origin: $server"
        exit 0
    }
    if ($server.StartsWith('http://')) {
        Write-Log 'warning: plain HTTP server; payload integrity is verified via SHA256'
    }

    $cacheBust = [DateTime]::Now.Ticks
    $remote = Invoke-RestMethod -Uri "$server/version.json?t=$cacheBust" -TimeoutSec 8
    $remoteVersion = [string]$remote.version
    $remoteSha = [string]$remote.sha256
    $remoteSize = [int]$remote.size
    $remoteFile = [string]$remote.file

    # Refuse a manifest that names anything other than the known payload.
    if ($remoteFile -ne 'office-toolbox-offline.html') {
        Write-Log "refusing unexpected payload name: $remoteFile"
        exit 0
    }
    if ($remoteSha -notmatch '^[0-9a-f]{64}$' -or $remoteSize -le 0) {
        Write-Log 'manifest has no valid sha256/size; refusing update'
        exit 0
    }

    # 2a. Self-update: refresh this script only when the downloaded bytes
    # match the hash recorded in the manifest (not merely "different").
    try {
        $expectedSelf = ''
        if ($remote.scripts -and $remote.scripts.PSObject.Properties['update.ps1']) {
            $expectedSelf = [string]$remote.scripts.PSObject.Properties['update.ps1'].Value
        }
        if ($expectedSelf -match '^[0-9a-f]{64}$') {
            $selfPath = $MyInvocation.MyCommand.Path
            $tmpSelf = Join-Path $env:TEMP 'office_toolbox_update_self.ps1'
            Invoke-WebRequest -Uri "$server/update.ps1?t=$cacheBust" -OutFile $tmpSelf -UseBasicParsing -TimeoutSec 8
            $hNew = Get-Sha256 $tmpSelf
            if ($hNew -eq $expectedSelf -and $hNew -ne (Get-Sha256 $selfPath)) {
                Copy-Item -Path $tmpSelf -Destination $selfPath -Force
                Write-Log 'self-update: update.ps1 verified against manifest and refreshed'
            }
        } else {
            Write-Log 'self-update skipped: manifest lacks update.ps1 hash'
        }
    } catch {
        Write-Log "self-update skipped: $($_.Exception.Message)"
    }

    # 2b. Compare versions and pull the new build when the server is newer.
    $localVersion = ''
    if (Test-Path $versionPath) { $localVersion = (Get-Content $versionPath -Raw).Trim() }

    if ($remoteVersion -and ($remoteVersion -ne $localVersion)) {
        $tmpHtml = Join-Path $dir 'office-toolbox-offline.html.new'
        try {
            Invoke-WebRequest -Uri "$server/$($remoteFile)?t=$cacheBust" -OutFile $tmpHtml -UseBasicParsing -TimeoutSec 120
            $actualSha = Get-Sha256 $tmpHtml
            $actualSize = (Get-Item $tmpHtml).Length
            if ($actualSha -ne $remoteSha -or $actualSize -ne $remoteSize) {
                throw "payload hash/size mismatch (got $actualSha / $actualSize)"
            }
            if (Test-Path $htmlPath) { Copy-Item -Path $htmlPath -Destination $bakPath -Force }
            Move-Item -Path $tmpHtml -Destination $htmlPath -Force
            # Write the version stamp last: a failed write never leaves the
            # client believing it has a build it does not actually own.
            Set-Content -Path $versionPath -Value $remoteVersion -Encoding ASCII
            if (Test-Path $bakPath) { Remove-Item $bakPath -Force -ErrorAction SilentlyContinue }
            Write-Log "app updated: '$localVersion' -> '$remoteVersion' (sha256 verified)"
        } catch {
            Write-Log "update failed, rolling back: $($_.Exception.Message)"
            if (Test-Path $tmpHtml) { Remove-Item $tmpHtml -Force -ErrorAction SilentlyContinue }
            Restore-Backup
        }
    } else {
        Write-Log "app up to date (version $localVersion)"
    }
} catch {
    Write-Log "update check failed (server unreachable?): $($_.Exception.Message)"
}
exit 0

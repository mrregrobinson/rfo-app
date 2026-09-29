<#
Weekly off-Railway copy of the production database backup into Dropbox, so a copy
survives independent of Railway (volume loss, account issue, etc.) and syncs to every
device on the account. The app already keeps 14 daily backups on the Railway volume
itself (server/backup.js) - this just mirrors the latest one out weekly and keeps its
own longer-horizon retention (13 weekly copies ~= 1 quarter) in Dropbox.

Run manually to test:
  powershell -File "backup-to-dropbox.ps1"

Scheduled via Windows Task Scheduler, task name "RFO DB Backup to Dropbox" (weekly).
#>

$ErrorActionPreference = 'Stop'

$RepoDir = 'C:\Users\mrreg\Dropbox\Personal\Family Office\Prime Quadrant\Due Diligence\ic-app'
$DestDir = 'C:\Users\mrreg\Dropbox\Personal\Family Office\RFO Backup'
$LogFile = Join-Path $DestDir '_backup-log.txt'
$KeepCount = 13
# Do NOT use the global "railway" install (npm i -g @railway/cli). That copy lives under
# a reparse point into Claude Desktop's own MSIX app-sandbox storage
# (AppData\Roaming\npm\node_modules\@railway is a symlink into
# AppData\Local\Packages\Claude_...) - it's only resolvable by processes descended from
# that app's own process tree, so it works when run through Claude Code but is invisible
# ("Cannot find module") to an independent process like a Task Scheduler task. This repo
# keeps its own local, physical copy in scripts/railway-cli/ specifically to avoid that.
$NodeExe = 'C:\Program Files\nodejs\node.exe'
$RailwayJs = Join-Path $PSScriptRoot 'railway-cli\node_modules\@railway\cli\bin\railway.js'
# Piping a native command through 2>&1 into a variable wraps every stderr line in a
# terminating ErrorRecord under $ErrorActionPreference = 'Stop', aborting the script on
# the first line of any stderr output (even non-fatal) and losing the rest of the
# message. Redirect stderr to a real file instead - a plain OS-level redirect, not routed
# through PowerShell's error stream - and surface it only if the exit code is non-zero.
$script:LastRailwayStderr = ''
function Invoke-Railway {
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        $stdout = & $NodeExe $RailwayJs @args 2>$errFile
        $script:LastRailwayStderr = (Get-Content -Path $errFile -Raw -ErrorAction SilentlyContinue)
        return $stdout
    } finally {
        Remove-Item $errFile -Force -ErrorAction SilentlyContinue
    }
}

function Write-Log($message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Write-Host $line
    # Dropbox's own sync client can briefly hold an exclusive lock on the log file right
    # after it's written; retry rather than let a transient lock fail the whole backup.
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Add-Content -Path $LogFile -Value $line -Encoding utf8 -ErrorAction Stop
            return
        } catch {
            if ($attempt -eq 5) { Write-Host "Warning: could not write to log file after 5 attempts." }
            else { Start-Sleep -Milliseconds (300 * $attempt) }
        }
    }
}

if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}

try {
    Set-Location $RepoDir

    $listJson = Invoke-Railway service files list /app/data/backups --json
    if ($LASTEXITCODE -ne 0) { throw "railway service files list failed (exit $LASTEXITCODE): $script:LastRailwayStderr" }
    $listing = $listJson | Out-String | ConvertFrom-Json
    $backups = $listing.files | Where-Object { $_.type -eq 'file' -and $_.name -like '*.db' } | Sort-Object name
    if (-not $backups -or $backups.Count -eq 0) { throw "No backup files found on the Railway volume." }

    $latest = $backups[-1]
    $localPath = Join-Path $DestDir $latest.name

    if (Test-Path $localPath) {
        Write-Log ("Latest backup {0} already copied - skipping download, will still enforce retention." -f $latest.name)
    } else {
        Invoke-Railway service files download "/app/data/backups/$($latest.name)" $localPath --overwrite --json | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "railway service files download failed (exit $LASTEXITCODE): $script:LastRailwayStderr" }
        $sizeMB = [math]::Round((Get-Item $localPath).Length / 1MB, 2)
        Write-Log ("Copied {0} ({1} MB) to {2}" -f $latest.name, $sizeMB, $DestDir)
    }

    # Retention: keep the KeepCount most recent dated backups; filenames are
    # ISO-timestamp-based (ic-YYYY-MM-DDTHH-MM-SS-mmmZ.db) so name sort == chronological.
    $existing = Get-ChildItem -Path $DestDir -Filter 'ic-*.db' | Sort-Object Name
    $excess = $existing.Count - $KeepCount
    if ($excess -gt 0) {
        $toDelete = $existing | Select-Object -First $excess
        foreach ($f in $toDelete) {
            Remove-Item $f.FullName -Force
            Write-Log ("Pruned old backup {0} (retention: keep last {1})" -f $f.Name, $KeepCount)
        }
    }

    $retained = [Math]::Min($existing.Count, $KeepCount)
    Write-Log ("Done. {0} backup(s) retained in {1}." -f $retained, $DestDir)
} catch {
    Write-Log ("ERROR: {0}" -f $_.Exception.Message)
    exit 1
}

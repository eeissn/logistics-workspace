param(
    [Parameter(Mandatory)] [string] $Python,
    [Parameter(Mandatory)] [string] $Destination,
    [ValidateRange(1, 2160)] [int] $MaxAgeHours = 36
)

$ErrorActionPreference = 'Stop'
$exitCode = 1
$message = ''
$log = $null
try {
    if (!(Test-Path -LiteralPath $Destination -PathType Container)) {
        throw "Backup destination does not exist: $Destination"
    }
    $log = Join-Path $Destination 'backup-audit.log'
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1MB) {
        Move-Item -LiteralPath $log -Destination (Join-Path $Destination 'backup-audit.previous.log') -Force
    }

    # Run from the repository root so Python can import the deploy package.
    Push-Location (Split-Path -Parent $PSScriptRoot)
    try {
        $lines = & $Python -m deploy.check_backup_freshness $Destination --max-age-hours $MaxAgeHours 2>&1
        $exitCode = $LASTEXITCODE
        $message = ($lines | Out-String).Trim()
    } finally {
        Pop-Location
    }
    Add-Content -LiteralPath $log -Encoding UTF8 -Value "$([DateTimeOffset]::Now.ToString('o')) [$exitCode] $message"
} catch {
    $exitCode = 1
    $message = $_.Exception.Message
    if ($log) {
        Add-Content -LiteralPath $log -Encoding UTF8 -Value "$([DateTimeOffset]::Now.ToString('o')) [1] $message" -ErrorAction SilentlyContinue
    }
}

if ($exitCode -ne 0) {
    # Notification is best-effort; failure must still appear in Task Scheduler and the audit log.
    try {
        $notice = New-Object -ComObject WScript.Shell
        $notice.Popup("Logistics Workspace: backup is stale, missing or corrupted. See backup-audit.log in $Destination.`n$message", 20, 'Logistics Workspace — Backup Alert', 48) | Out-Null
    } catch {
        Write-Warning "Unable to show backup alert: $($_.Exception.Message)"
    }
}
if ($message) { Write-Output $message }
exit $exitCode

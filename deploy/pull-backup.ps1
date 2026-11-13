param(
    [Parameter(Mandatory)] [string] $Python,
    [Parameter(Mandatory)] [string] $Server,
    [Parameter(Mandatory)] [string] $Identity,
    [Parameter(Mandatory)] [string] $KnownHosts,
    [Parameter(Mandatory)] [string] $Destination
)

$ErrorActionPreference = 'Stop'
$exitCode = 1
$message = ''
try {
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    $log = Join-Path $Destination 'backup-delivery.log'
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1MB) {
        Move-Item -LiteralPath $log -Destination (Join-Path $Destination 'backup-delivery.previous.log') -Force
    }
    $resultLines = & $Python (Join-Path $PSScriptRoot 'backup_delivery.py') pull $Server $Identity $KnownHosts $Destination 2>&1
    $exitCode = $LASTEXITCODE
    $message = ($resultLines | Out-String).Trim()
    Add-Content -LiteralPath $log -Encoding UTF8 -Value "$([DateTimeOffset]::Now.ToString('o')) [$exitCode] $message"
} catch {
    $exitCode = 1
    $message = $_.Exception.Message
    if ($log) {
        Add-Content -LiteralPath $log -Encoding UTF8 -Value "$([DateTimeOffset]::Now.ToString('o')) [1] $message" -ErrorAction SilentlyContinue
    }
}
if ($exitCode -ne 0) {
    $notice = New-Object -ComObject WScript.Shell
    $notice.Popup("Logistics Workspace backup failed. Check backup-delivery.log in $Destination.`n$message", 20, 'Logistics Workspace', 48) | Out-Null
}
exit $exitCode

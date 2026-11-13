param(
    [Parameter(Mandatory)] [string] $Python,
    [Parameter(Mandatory)] [string] $Server,
    [Parameter(Mandatory)] [string] $Identity,
    [Parameter(Mandatory)] [string] $KnownHosts,
    [Parameter(Mandatory)] [string] $Destination
)

$ErrorActionPreference = 'Stop'
$taskName = 'Logistics Workspace Backup'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$script = Join-Path $PSScriptRoot 'pull-backup.ps1'
$paths = @($Python, $script, $Identity, $KnownHosts, $Destination)
foreach ($path in $paths) {
    if ($path -notmatch '^[A-Za-z]:\\' -or $path -match '["\r\n]' -or $path.EndsWith('\')) {
        throw 'Use absolute local paths without a trailing backslash.'
    }
}
if ($Server -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') { throw 'Use a DNS name or IPv4 address.' }
foreach ($path in @($Python, $script, $Identity, $KnownHosts, $Destination)) {
    if (!(Test-Path -LiteralPath $path)) { throw "Path does not exist: $path" }
}
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument (
    '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -Python "{1}" -Server "{2}" -Identity "{3}" -KnownHosts "{4}" -Destination "{5}"' -f
    $script, $Python, $Server, $Identity, $KnownHosts, $Destination
)
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $account),
    (New-ScheduledTaskTrigger -Daily -At 8am),
    (New-ScheduledTaskTrigger -Daily -At 2pm),
    (New-ScheduledTaskTrigger -Daily -At 8pm)
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal

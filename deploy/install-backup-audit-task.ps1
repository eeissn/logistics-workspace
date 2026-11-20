param(
    [Parameter(Mandatory)] [string] $Python,
    [Parameter(Mandatory)] [string] $Destination,
    [ValidateRange(1, 2160)] [int] $MaxAgeHours = 36
)

$ErrorActionPreference = 'Stop'
$taskName = 'Logistics Workspace Backup Audit'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$script = Join-Path $PSScriptRoot 'audit_backup.py'
foreach ($path in @($Python, $script, $Destination)) {
    if ($path -notmatch '^[A-Za-z]:\\' -or $path -match '["\r\n]' -or $path.EndsWith([IO.Path]::DirectorySeparatorChar)) {
        throw 'Use absolute local paths without a trailing backslash.'
    }
    if (!(Test-Path -LiteralPath $path)) {
        throw "Path does not exist: $path"
    }
}
if (!(Test-Path -LiteralPath $Destination -PathType Container)) {
    throw "Destination is not a directory: $Destination"
}

# Launch Python directly without a console; no PowerShell policy changes.
$taskPython = Join-Path (Split-Path -Parent $Python) 'pythonw.exe'
if (!(Test-Path -LiteralPath $taskPython -PathType Leaf)) {
    throw 'Use a Windows Python installation with pythonw.exe beside python.exe.'
}
$action = New-ScheduledTaskAction -Execute $taskPython -Argument (
    '-m deploy.audit_backup "{0}" --max-age-hours {1}' -f $Destination, $MaxAgeHours
) -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
# Half an hour after the existing delivery triggers (08:00, 14:00, 20:00).
# StartWhenAvailable covers missed runs after the PC resumes.
$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At '08:30'),
    (New-ScheduledTaskTrigger -Daily -At '14:30'),
    (New-ScheduledTaskTrigger -Daily -At '20:30')
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal

"""Windows backup audit entry point; no download, decrypt, or backup-file mutation."""
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import subprocess
import sys

from deploy.check_backup_freshness import verify_latest


def notify_windows():
    if os.name != "nt":
        return
    # Constant notification text: no paths or untrusted diagnostic text enter code.
    command = "(New-Object -ComObject WScript.Shell).Popup('The encrypted backup is stale, missing or damaged. See backup-audit.log in the backup folder.',20,'Sputnik Workspace - Backup Alert',48) | Out-Null"
    powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    subprocess.run([str(powershell), '-NoLogo', '-NoProfile', '-NonInteractive',
                    '-WindowStyle', 'Hidden', '-Command', command],
                   timeout=25, check=False, capture_output=True,
                   creationflags=subprocess.CREATE_NO_WINDOW)


def audit(folder, *, max_age=timedelta(hours=36), now=None, notify=notify_windows):
    now = now or datetime.now(timezone.utc)
    code = 0
    try:
        name, age = verify_latest(folder, now, max_age)
        message = f"BACKUP OK: {name}; age {age.total_seconds()/3600:.1f}h; SHA-256 and size verified"
    except (ValueError, OSError) as error:
        code, message = 1, f"BACKUP ALERT: {error}"
    try:
        if not folder.is_dir():
            raise ValueError("Backup directory is missing")
        log, previous = folder / 'backup-audit.log', folder / 'backup-audit.previous.log'
        if log.is_symlink() or previous.is_symlink():
            raise ValueError("Audit log cannot be a symbolic link")
        if log.exists() and log.stat().st_size > 1024 * 1024:
            log.replace(previous)
        with log.open('a', encoding='utf-8') as stream:
            stream.write(f"{now.isoformat()} [{code}] {message}\n")
    except (ValueError, OSError) as error:
        code, message = 1, f"BACKUP ALERT: audit log unavailable ({error})"
    print(message, file=sys.stderr if code else sys.stdout)
    if code:
        try:
            notify()
        except Exception:
            print('Backup warning could not be displayed; check task result and audit log.', file=sys.stderr)
    return code


def main(argv=None):
    parser = argparse.ArgumentParser(description='Audit delivered encrypted backups and alert on failure')
    parser.add_argument('folder', type=Path)
    parser.add_argument('--max-age-hours', type=float, default=36)
    args = parser.parse_args(argv)
    if not 0 < args.max_age_hours <= 2160:
        parser.error('--max-age-hours must be in (0, 2160]')
    return audit(args.folder, max_age=timedelta(hours=args.max_age_hours))


if __name__ == '__main__':
    raise SystemExit(main())

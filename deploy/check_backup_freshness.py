"""Read-only verification of the latest locally delivered encrypted backup.

This does not schedule downloads, access the VPS, decrypt archives, or change files.
Run separately from the existing Windows task to diagnose stale/missed deliveries.
"""
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

from deploy.backup_delivery import NAME, file_info, read_manifest, snapshot_time


def verify_latest(folder: Path, now: datetime, max_age: timedelta = timedelta(hours=36)):
    """Return (filename, age) or raise a meaningful error; never modify files."""
    if now.tzinfo is None:
        raise ValueError("Use an offset-aware current time.")
    receipts = folder / ".verified"
    if not receipts.is_dir():
        raise ValueError("No verified-backup receipt directory.")
    candidates = []
    for receipt in receipts.iterdir():
        if receipt.is_symlink() or not receipt.is_file() or receipt.suffix != ".json":
            continue
        name = receipt.stem + ".cms"
        if NAME.fullmatch(name):
            candidates.append((snapshot_time(name), name, receipt))
    if not candidates:
        raise ValueError("No verified encrypted backup receipts.")
    stamp, name, receipt = max(candidates, key=lambda item: item[0])
    age = now.astimezone(timezone.utc) - stamp
    if age < timedelta(minutes=-5):
        raise ValueError("Backup timestamp is more than five minutes in the future.")
    if age > max_age:
        raise ValueError(f"Latest backup is stale: {name} (max age {max_age}).")
    archive = folder / name
    if not archive.is_file() or archive.is_symlink():
        raise ValueError("Latest verified backup archive is missing.")
    if file_info(archive) != read_manifest(receipt):
        raise ValueError("Latest backup fails SHA-256/size verification.")
    return name, age


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check latest encrypted backup freshness and SHA-256 locally")
    parser.add_argument("folder", type=Path, help="Destination directory used by the Windows backup task")
    parser.add_argument("--max-age-hours", type=float, default=36.0)
    args = parser.parse_args(argv)
    if not 0 < args.max_age_hours <= 24 * 90:
        parser.error("--max-age-hours must be in (0, 2160]")
    try:
        name, age = verify_latest(args.folder, datetime.now(timezone.utc),
                                  timedelta(hours=args.max_age_hours))
    except (ValueError, OSError) as exc:
        print(f"BACKUP ALERT: {exc}", file=sys.stderr)
        return 1
    print(f"BACKUP OK: {name}; age {age.total_seconds()/3600:.1f}h; SHA-256 and size verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Read-only check that a fresh, intact encrypted backup is PUBLISHED on the VPS.

PUBLISHED does not mean SENT or DELIVERED to the separate Windows computer.
SFTP downloads are initiated by the receiving PC; this command does not contact it.
"""
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

from deploy.backup_delivery import NAME, file_info, read_manifest, snapshot_time


def verify_published(outbox: Path, now: datetime, max_age: timedelta = timedelta(hours=36)):
    """Return (archive name, age) for latest complete, verified published bundle.

    Never modify files or follow symlinks. An incomplete newest publication is
    a failure, not an excuse to silently fall back to an older good bundle.
    """
    if now.tzinfo is None:
        raise ValueError("Current time must include a timezone.")
    if outbox.is_symlink() or not outbox.is_dir():
        raise ValueError("Outbox missing or not a regular directory.")
    candidates = []
    for entry in outbox.iterdir():
        if entry.is_symlink() or not entry.is_dir() or not NAME.fullmatch(entry.name):
            continue
        candidates.append((snapshot_time(entry.name), entry))
    if not candidates:
        raise ValueError("No published encrypted CMS bundles in outbox.")
    timestamp, bundle = max(candidates, key=lambda item: item[0])
    age = now.astimezone(timezone.utc) - timestamp
    if age < timedelta(minutes=-5):
        raise ValueError("Latest published backup has a future timestamp.")
    if age > max_age:
        raise ValueError(f"Latest published backup is stale: {bundle.name}; max age {max_age}.")

    encrypted = bundle / bundle.name
    manifest = bundle / (bundle.name[:-4] + ".json")
    for path in (encrypted, manifest):
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing or unsafe published file: {path.name}")
    expected = read_manifest(manifest)
    actual = file_info(encrypted)
    if expected != actual:
        raise ValueError(f"Published CMS size/SHA-256 mismatch: {bundle.name}")
    return bundle.name, age


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outbox", type=Path, help="Published CMS bundle directory on the VPS")
    parser.add_argument("--max-age-hours", type=float, default=36.0)
    args = parser.parse_args(argv)
    if not 0 < args.max_age_hours <= 2160:
        parser.error("--max-age-hours must be in (0, 2160]")
    try:
        name, age = verify_published(
            args.outbox, datetime.now(timezone.utc),
            timedelta(hours=args.max_age_hours),
        )
    except (OSError, ValueError) as error:
        print(f"OUTBOX ALERT: {error}", file=sys.stderr)
        return 1
    print(f"OUTBOX OK (published, NOT delivery-confirmed): {name}; "
          f"age {age.total_seconds() / 3600:.1f}h; CMS SHA-256 and size match")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Fail-closed Linux open-file check for a stopped application's SQLite files."""
import argparse
import os
from pathlib import Path


def assert_unused(database, proc=Path('/proc')):
    identities = set()
    for suffix in ('', '-wal', '-shm'):
        try:
            stat = Path(str(database) + suffix).stat()
            identities.add((stat.st_dev, stat.st_ino))
        except FileNotFoundError:
            if not suffix:
                raise ValueError('Database file missing') from None
    if not proc.is_dir():
        raise ValueError('Linux process filesystem unavailable')
    for process in proc.iterdir():
        if not process.name.isdecimal():
            continue
        try:
            for descriptor in (process / 'fd').iterdir():
                try:
                    stat = descriptor.stat()
                except (FileNotFoundError, ProcessLookupError):
                    continue  # A descriptor/process closed during enumeration.
                if (stat.st_dev, stat.st_ino) in identities:
                    raise ValueError('SQLite file is still open; refusing migration')
        except (FileNotFoundError, ProcessLookupError):
            continue
        # PermissionError and other inspection errors deliberately propagate.


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Root is required to inspect every process')
    assert_unused(args.database)
    print('No SQLite file users remain')

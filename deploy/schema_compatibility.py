"""Inspect or explicitly change only the additive schema-3 compatibility marker.

No automatic production use. Stop all application writers and obtain explicit
owner authorization before using the mutation option outside an isolated copy.
The saved_views table and every business row are retained for a later upgrade.
"""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3

from backend.app import database
from backend.saved_views import verify_saved_views_schema


def checked_path(path):
    path = Path(path).expanduser().resolve()
    if not path.is_file():
        raise ValueError("Existing SQLite file required")
    return path


def inspect_connection(db):
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version not in (2, 3):
        raise ValueError("Only tested schema versions 2 and 3 are supported")
    verify_saved_views_schema(db)
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("SQLite integrity check failed")
    if db.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("SQLite foreign key check failed")
    counts = {name: db.execute("SELECT COUNT(*) FROM "+name).fetchone()[0]
              for name in ("users", "registry", "orders", "saved_views")}
    return {"schema": version, "counts": counts, "integrity": "ok"}


def inspect(path):
    path = checked_path(path)
    with closing(sqlite3.connect(path.as_uri()+"?mode=ro", uri=True)) as db:
        return inspect_connection(db)


def set_schema2_marker(path):
    path = checked_path(path)
    with database(path, write=True) as db:
        before = inspect_connection(db)
        if before["schema"] != 3:
            raise ValueError("Expected schema 3 before compatibility rollback")
        db.execute("PRAGMA user_version=2")
        return {**before, "schema": 2, "saved_views_retained": True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--set-schema2-marker", action="store_true",
                        help="MUTATES schema marker only; production requires separate authorization")
    args = parser.parse_args(argv)
    result = set_schema2_marker(args.database) if args.set_schema2_marker else inspect(args.database)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()

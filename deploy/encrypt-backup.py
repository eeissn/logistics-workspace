"""Seal a completed SQLite backup for a recipient with OpenSSL CMS."""

import argparse
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
from tempfile import NamedTemporaryFile


def snapshot_identity(path):
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns


def check_snapshot(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Use a completed SQLite backup file.")
    if any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise ValueError("The backup has SQLite sidecar files.")


def encrypt_backup(source, recipient, target, openssl):
    check_snapshot(source)
    source = source.resolve(strict=True)
    identity = snapshot_identity(source)
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed.")

    target = target.absolute()
    if target.exists() or target.is_symlink():
        raise FileExistsError("The destination already exists.")
    with NamedTemporaryFile(prefix=".encrypt-", dir=target.parent, delete=False) as staging:
        temporary = Path(staging.name)
    try:
        subprocess.run(
            [openssl, "cms", "-encrypt", "-binary", "-aes-256-gcm",
             "-in", str(source), "-outform", "DER", "-out", str(temporary),
             "-recip", str(recipient.resolve(strict=True)), "-keyopt",
             "rsa_padding_mode:oaep", "-keyopt", "rsa_oaep_md:sha256"],
            check=True,
        )
        check_snapshot(source)
        if snapshot_identity(source) != identity:
            raise ValueError("The source changed during encryption.")
        if not temporary.stat().st_size:
            raise ValueError("OpenSSL produced an empty file.")
        with temporary.open("r+b") as encrypted:
            os.fsync(encrypted.fileno())
        # Atomic publication in the target directory, with no overwrite.
        if os.name == "nt":
            os.rename(temporary, target)
        else:
            os.link(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("recipient_certificate", type=Path)
    parser.add_argument("encrypted_output", type=Path)
    parser.add_argument("--openssl", default="openssl")
    args = parser.parse_args()
    try:
        encrypt_backup(args.backup, args.recipient_certificate, args.encrypted_output, args.openssl)
    except (OSError, ValueError, sqlite3.Error, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Backup encryption failed: {error}\n")
    print("Encrypted backup ready:", args.encrypted_output.name)


if __name__ == "__main__":
    main()

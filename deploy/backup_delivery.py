"""Publish and retrieve completed encrypted Logistics Workspace backups."""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory


STAMP = "%Y%m%dT%H%M%SZ"
NAME = re.compile(r"workspace-(\d{8}T\d{6}Z)\.cms")


def snapshot_time(name):
    match = NAME.fullmatch(name)
    if not match:
        raise ValueError("Unexpected backup filename.")
    return datetime.strptime(match[1], STAMP).replace(tzinfo=timezone.utc)


def file_info(path):
    with path.open("rb") as stream:
        return {"size": os.fstat(stream.fileno()).st_size, "sha256": hashlib.file_digest(stream, "sha256").hexdigest()}


def publish(args):
    timestamp = datetime.strptime(args.snapshot_utc, STAMP)
    name = f"workspace-{timestamp.strftime(STAMP)}.cms"
    destination = args.outbox / name
    if destination.exists():
        raise FileExistsError(f"Backup already published: {name}")
    # The staging directory is private and shares a filesystem with the outbox.
    with TemporaryDirectory(prefix=".seal-", dir=args.outbox) as directory:
        bundle = Path(directory) / name
        bundle.mkdir(mode=0o755)
        staged = bundle / name
        subprocess.run(
            [sys.executable, str(Path(__file__).with_name("encrypt-backup.py")), str(args.source),
             str(args.certificate), str(staged), "--openssl", args.openssl],
            check=True,
        )
        manifest = staged.with_suffix(".json")
        with manifest.open("w", encoding="ascii") as stream:
            json.dump(file_info(staged), stream)
            stream.flush()
            os.fsync(stream.fileno())
        for path in (staged, manifest):
            path.chmod(0o644)
        bundle.chmod(0o755)
        # A unique directory makes the pair visible in a single rename.
        if destination.exists():
            raise FileExistsError(f"Backup already published: {name}")
        bundle.rename(destination)
    print(f"Published {name}")


class Sftp:
    def __init__(self, host, port, identity, known_hosts):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", host):
            raise ValueError("Use a DNS name or IPv4 address for the SFTP host.")
        self.command = [
            "sftp", "-F", "none", "-P", str(port), "-i", str(identity.resolve(strict=True)),
            "-o", f'UserKnownHostsFile="{known_hosts.resolve(strict=True)}"',
            "-o", "GlobalKnownHostsFile=none", "-o", "StrictHostKeyChecking=yes",
            "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "BatchMode=yes",
            "-o", "PreferredAuthentications=publickey", "-o", "ConnectTimeout=20",
            "-b", "-", f"logistics-backup@{host}",
        ]

    def batch(self, commands, directory=None):
        return subprocess.run(
            self.command, input=commands, text=True, capture_output=True, check=True,
            timeout=300, cwd=directory,
        ).stdout

    def list_backups(self):
        return self.batch("ls -1 /outbox\n").splitlines()

    def download(self, name, directory):
        snapshot_time(name)
        manifest = Path(name).with_suffix(".json").name
        self.batch(f"get /outbox/{name}/{manifest} {manifest}\nget /outbox/{name}/{name} {name}\n", directory)


def retrieve(remote, folder, now, max_age, retention):
    names = []
    for entry in remote.list_backups():
        name = entry.strip().removeprefix("/outbox/")
        if NAME.fullmatch(name):
            names.append((snapshot_time(name), name))
    if not names:
        raise ValueError("No completed encrypted backups in the outbox.")
    snapshot, name = max(names)
    if snapshot > now + timedelta(minutes=5) or now - snapshot > max_age:
        raise ValueError(f"Backup timestamp outside the freshness window: {name}")

    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    receipts = folder / ".verified"
    receipts.mkdir(exist_ok=True)
    receipt = receipts / Path(name).with_suffix(".json")
    already_verified = (
        target.is_file() and receipt.is_file()
        and file_info(target) == json.loads(receipt.read_text(encoding="ascii"))
    )
    if not already_verified:
        with TemporaryDirectory(prefix=".download-", dir=folder) as directory:
            staging = Path(directory)
            remote.download(name, staging)
            manifest = staging / receipt.name
            expected = json.loads(manifest.read_text(encoding="ascii"))
            encrypted = staging / name
            actual = file_info(encrypted)
            if not actual["size"] or expected != actual:
                raise ValueError(f"Downloaded archive failed size or SHA-256 verification: {name}")
            if target.exists():
                if file_info(target) != actual:
                    raise FileExistsError(f"Local archive differs from verified download: {name}")
            else:
                with encrypted.open("rb+") as stream:
                    os.fsync(stream.fileno())
                os.link(encrypted, target)
            os.replace(manifest, receipt)

    # Only rotate archives recorded by this task, and only after verifying the latest.
    for older in receipts.glob("workspace-*.json"):
        archive = older.with_suffix(".cms").name
        if NAME.fullmatch(archive) and now - snapshot_time(archive) > retention:
            (folder / archive).unlink(missing_ok=True)
            older.unlink(missing_ok=True)
    return name, already_verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    publication = commands.add_parser("publish")
    for name in ("source", "certificate", "outbox"):
        publication.add_argument(name, type=Path)
    publication.add_argument("snapshot_utc")
    publication.add_argument("--openssl", default="openssl")
    pull = commands.add_parser("pull")
    pull.add_argument("host")
    for name in ("identity", "known_hosts", "folder"):
        pull.add_argument(name, type=Path)
    pull.add_argument("--port", type=int, default=22)
    pull.add_argument("--max-age-hours", type=int, default=36)
    pull.add_argument("--retention-days", type=int, default=45)
    args = parser.parse_args()
    try:
        if args.command == "publish":
            publish(args)
        else:
            if args.max_age_hours < 1 or args.retention_days * 24 <= args.max_age_hours:
                raise ValueError("Retention must exceed the positive freshness window.")
            name, existing = retrieve(
                Sftp(args.host, args.port, args.identity, args.known_hosts),
                args.folder, datetime.now(timezone.utc),
                timedelta(hours=args.max_age_hours), timedelta(days=args.retention_days),
            )
            print(f"{'Already verified' if existing else 'Downloaded and verified'} {name}")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        detail = (error.stderr or str(error)).strip() if isinstance(error, subprocess.CalledProcessError) else error
        parser.exit(1, f"Backup delivery failed: {detail}\n")


if __name__ == "__main__":
    main()

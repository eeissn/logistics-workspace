"""Synthetic, isolated capacity/recovery benchmark for proposed PDF originals BLOB storage.

Never reads or modifies DATABASE_PATH, server files, real orders, or PDF documents.
Not a production attachment schema. Measures only SQLite write/backup/recovery.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from time import perf_counter

from backend.app import backup


ROLES = ("customer", "carrier")
MAX_SYNTHETIC_KIB = 256 * 1024


def validate_scale(orders, pdf_kib):
    if type(orders) is not int or type(pdf_kib) is not int:
        raise ValueError("Scale must use integers")
    if not 1 <= orders <= 5000 or not 1 <= pdf_kib <= 256:
        raise ValueError("Use 1–5000 orders and 1–256 KiB per synthetic PDF")
    if orders * len(ROLES) * pdf_kib > MAX_SYNTHETIC_KIB:
        raise ValueError("Synthetic payload budget is capped at 256 MiB")


def synthetic_pdf(seed, size):
    # Mimics opaque binary byte volume, not a parseable PDF or real user file.
    head = b"%PDF-1.7\n"
    return head + hashlib.shake_256(seed.encode("ascii")).digest(size - len(head))


def benchmark(orders=515, pdf_kib=64):
    validate_scale(orders, pdf_kib)
    size = pdf_kib * 1024
    with TemporaryDirectory(prefix="lw-pdf-originals-sizing-") as folder:
        root = Path(folder)
        source, restored = root / "source.sqlite3", root / "restored.sqlite3"
        with sqlite3.connect(source) as db:
            db.execute("PRAGMA foreign_keys=ON")
            # Test-only minimal analogue of the real per-user order primary key.
            db.executescript("""
                CREATE TABLE registry(owner TEXT PRIMARY KEY);
                CREATE TABLE orders(
                    owner TEXT NOT NULL REFERENCES registry(owner),
                    number TEXT NOT NULL,
                    PRIMARY KEY(owner, number)
                );
                CREATE TABLE originals(
                    owner TEXT NOT NULL,
                    number TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('customer','carrier')),
                    digest TEXT NOT NULL,
                    content BLOB NOT NULL,
                    PRIMARY KEY(owner, number, role),
                    FOREIGN KEY(owner, number) REFERENCES orders(owner, number)
                );
            """)
            db.executemany("INSERT INTO registry(owner) VALUES (?)",
                           [("synthetic-a",), ("synthetic-b",)])
            written = 0
            for index in range(orders):
                owner = "synthetic-a" if index % 2 == 0 else "synthetic-b"
                number = f"TEST-{index // 2 + 1:05d}"
                db.execute("INSERT INTO orders(owner,number) VALUES (?,?)", (owner, number))
                for role in ROLES:
                    content = synthetic_pdf(f"{index}:{role}", size)
                    digest = hashlib.sha256(content).hexdigest()
                    db.execute(
                        "INSERT INTO originals(owner,number,role,digest,content) "
                        "VALUES (?,?,?,?,?)", (owner, number, role, digest, content),
                    )
                    written += 1
            db.commit()
        begin = perf_counter()
        backup(source, restored)  # Production SQLite online backup implementation.
        backup_seconds = perf_counter() - begin
        with sqlite3.connect(restored) as db:
            db.execute("PRAGMA foreign_keys=ON")
            integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
            foreign_keys = db.execute("PRAGMA foreign_key_check").fetchall()
            entries = db.execute(
                "SELECT owner,number,role,digest,content FROM originals"
            ).fetchall()
            recovered = len(entries)
            byte_exact = all(hashlib.sha256(content).hexdigest() == digest
                             for owner, number, role, digest, content in entries)
            cross_owner_numbers = db.execute("""
                SELECT COUNT(*) FROM (
                    SELECT number FROM orders
                    GROUP BY number HAVING COUNT(DISTINCT owner)>1
                )
            """).fetchone()[0]
            complete = db.execute("""
                SELECT COUNT(*) FROM (
                    SELECT owner,number FROM originals
                    GROUP BY owner,number HAVING COUNT(DISTINCT role)=2
                )
            """).fetchone()[0]
        if (integrity != "ok" or foreign_keys or not byte_exact or
                recovered != written or complete != orders or
                (orders >= 2 and cross_owner_numbers == 0)):
            raise RuntimeError("Synthetic attachment recovery/ownership check failed")
        return {
            "synthetic_only": True,
            "orders": orders,
            "files": written,
            "pdf_kib": pdf_kib,
            "payload_mib": round(written * size / (1024 * 1024), 2),
            "sqlite_mib": round(source.stat().st_size / (1024 * 1024), 2),
            "backup_mib": round(restored.stat().st_size / (1024 * 1024), 2),
            "backup_seconds": round(backup_seconds, 3),
            "integrity": integrity,
            "foreign_keys_ok": not foreign_keys,
            "restored_bytes_sha256_ok": byte_exact,
            "orders_with_both_files": complete,
            "shared_numbers_across_accounts": cross_owner_numbers,
        }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orders", type=int, default=515)
    parser.add_argument("--pdf-kib", type=int, default=64)
    args = parser.parse_args(argv)
    try:
        result = benchmark(args.orders, args.pdf_kib)
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        parser.exit(1, f"PDF originals benchmark failed: {error}\n")
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()

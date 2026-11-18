# Originals of both PDF contracts — security and backup decision record (draft)

Status: **design + isolated synthetic feasibility test only; no attachment endpoints, schema changes, or file uploads to VPS**. Based on the existing FastAPI/SQLite API, local PDF.js import, and the owner's approved UX idea № 5 (Rill). The current import reads two PDFs in the browser, extracts text, then submits normalized order data; **original PDF bytes are not sent to the server**.

## Purpose

Keep both original PDF documents next to the authenticated owner's order:
1. **Customer contract PDF** (заказчик ↔ экспедитор).
2. **Carrier contract PDF** (экспедитор ↔ перевозчик).

Display a clear distinction between *original attached*, *not yet attached*, and *local preview only*. Do not label synthesized text or an absent PDF as an original.

## Existing constraints

- Two completely isolated accounts; each sees only its own orders by authenticated server owner. The same order number may exist in both accounts.
- SQLite schema version 2 contains `orders(owner, number, payload)`. `GET/PUT /api/records` saves registry JSON; `PATCH /api/etrn` updates a single owned order. Attaching files must not require serializing file bytes into the registry.
- `src/app.mjs` currently requires exactly two PDFs and uses browser-side `readPdf()`, `importPair()`, `openReview()`. Saving order is a **separate confirmed action**.
- VPS is small (~875 MiB RAM, 15 GiB disk). Existing SQLite backup uses the SQLite online-backup API; remote backup delivery encrypts and transfers the resulting SQLite file. **A directory full of PDFs would not be included in that backup today.**

## Reproducible capacity/recovery test (synthetic only)

Run from a checkout with Python dependencies installed:

```bash
python -m unittest backend.test_pdf_originals_feasibility -v
python -m backend.pdf_originals_feasibility --orders 515 --pdf-kib 64
```

The benchmark creates temporary SQLite files, a **test-only** table for `owner,number,role,content,digest`, and exactly two synthetic binary payloads per order. It uses the actual `backend.app.backup` function for a SQLite online backup, reopens the backup, checks `integrity_check`, foreign keys, distinct owner+order keys, both roles, and byte-exact SHA-256 restoration. It prints actual temporary source/backup sizes and backup duration for that run. All files are discarded at completion.

The default test workload is 515 synthetic orders × 2 payloads × 64 KiB (~64.4 MiB of payload). Adjust `--pdf-kib` only after measuring **anonymized aggregate** sizes of real PDF pairs; the tool enforces a 256 MiB upper bound on synthetic bytes to avoid consuming the VPS disk. **Run on developer/CI hardware, not the production VPS.** Synthetic opaque payloads are not valid PDFs and do not model actual compression, encryption, network transfer time, daily growth, or peak WAL disk use. The benchmark cannot certify that a full backup fits the VPS or successfully arrives on the home Windows computer.

For an actual rollout, measure without sharing originals: PDF pair size distribution (median/p95/maximum), free space, snapshot duration, remote transfer speed, local storage retention and restore time. Rehearse end-to-end encrypted restoration on an isolated copy. Until those measurements and owner decisions exist, keep the upload endpoints disabled.

## Choice needed before implementation

**A. Store originals in the same SQLite DB as BLOBs** (simpler recovery and atomic relations; backup includes PDFs automatically, but file sizes increase SQLite, daily copy time and encrypted upload volume). Requires a measured disk/backup sizing exercise and bounded individual/total quotas.

**B. Store originals as private files outside Git and web root** (more efficient for large files, but requires a *new verified atomic backup/restore protocol for DB + files* before production use). Existing SQLite-only encrypted backups would be insufficient. File and metadata consistency must survive crashes and deletion.

**No automatic choice until sample file sizes and backup capacity are measured.** For either model: limit initial upload to one customer and one carrier PDF per order, use immutable SHA-256 fingerprints, and keep an explicit replacement history or a separately specified retention policy.

## Minimum server contract (proposed, not exposed)

- `POST /api/orders/{number}/originals/{role}` with CSRF and exact authenticated owner; role one of `customer`, `carrier`.
- `GET /api/orders/{number}/originals` returns metadata only for authenticated owner.
- `GET /api/orders/{number}/originals/{role}` securely streams PDF from this owner's order; `Content-Disposition: attachment` by default, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- A replacement must be explicit and confirmed in UI. Absence returns 404. Cross-tenant existence must never be leaked by response differences.
- Put file limits and quotas server-side; reject empty files, non-PDF signature and invalid content, and use bounded streaming instead of reading untrusted 20 MiB+ bodies into memory. Never trust uploaded filenames or filesystem paths.
- Authorize with existing session + CSRF for mutation; validate ownership and order existence *inside the same transaction*. `404/409` must be actionable. Never trust owner/order identity from the request body.
- Never log PDF bytes, passport fields, preview text or signed download links. File access requires live authenticated session; no public or guessable static URLs.

## Import and UI

1. Read and validate both locally, show the existing preview of the recognized order and discrepancies.
2. Only after the user explicitly presses **Save**, upload original bytes to the authenticated account/order. Preserve originals unchanged and associate the correct role regardless of input order.
3. A partial upload is **not presented as complete**: display “1 of 2 files attached”, a retry for only the missing file, and an explicit error. Existing order data must not disappear.
4. Repeat import is never allowed to silently replace an already attached original. Preview the new hash/filename and request explicit confirmation.
5. Old orders are marked “original not attached”; previously imported PDFs cannot be reconstructed from extracted text. Backfilling old files requires deliberate reattachment, **not** reimporting all 515+ records.
6. On iPhone the two PDF buttons stay within order context without assuming files remain available on the device after refresh.

## Recovery acceptance gate

- Test two accounts, identical order number, no access from A to B (metadata, download, overwrite, delete).
- Test logout while an upload/download is pending; CSRF, stale session, malicious/oversized/truncated PDF, filename traversal, simultaneous replacements and interrupted transfer.
- Verify **byte-for-byte** restoration of both PDF originals *and* the associated owner/order/role metadata from a complete encrypted backup on an isolated copy. Compare SHA-256 and sqlite integrity, including a test after a partially completed upload.
- Measure disk consumption, incremental growth and backup completion time at a synthetic 515+ order scale, without storing real PDFs in tests or Git.
- Provide explicit rollback that retains existing originals and does not silently drop attachments.
- UI acceptance: Windows/Zen and Safari/iPhone, same order both roles, partial attachment, absent originals, repeat import, separate accounts.

## Office decisions requested before coding

1. Are originals needed for **all new orders only**, or do you also want voluntary attachment for previously imported orders?
2. Is retaining **only the latest copy** acceptable, or should replacement history be preserved?
3. Confirm that PDF bytes must be included in the same verified off-server encrypted backup/recovery workflow before enabling uploads to production.

No deployment, SQLite schema change, collection of actual PDF bytes, or production upload endpoint is authorized by this document.

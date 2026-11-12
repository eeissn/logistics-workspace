# Server synchronization implementation plan

Goal: turn existing static Logistics Workspace into a secure two-user synchronized application on a low-memory Ubuntu 24.04 VPS (~875 MiB RAM, 15 GB disk), preserving current browser UI, PDF import, margin logic and all tests.

Current state: Vite frontend, src/storage.mjs uses browser storage; no backend. Existing build works with Node 22. The VPS has Python 3.12, a Python venv at /opt/logistics-workspace/backend-venv with FastAPI and Uvicorn, nginx, and an empty data directory at /opt/logistics-workspace/data. Git clone resides at /opt/logistics-workspace/logistics-workspace.

Implementation requirements:
1. Add FastAPI API under backend/, SQLite DB outside Git working tree at configurable DATABASE_PATH, migration/init schema for records and users. No real data or credentials committed.
2. Exactly two manually provisioned accounts initially, with salted password hashes (Argon2id preferred; scrypt acceptable), session authentication via HttpOnly Secure SameSite cookies, CSRF defense, login/logout/me, basic rate limiting, input validation, size limits, and no unauthenticated data API.
3. Per-account records API scoped on the server to the authenticated user, with independent revisions, conflict response 409, server-side timestamps and backups. Same-account sessions synchronize across devices. Preserve the previous shared registry in restricted legacy tables without assigning ownership. Preserve existing record semantics, including PDF-derived carrier windows, payment terms, contact fields, ETRN statuses, and margin calculations. Do not log sensitive fields.
4. Update frontend storage adapter to use authenticated API for both users, with loading, error, conflict and offline states. Avoid silent overwrites and automatic migration of local data; provide explicit import/migration with confirmation.
5. Nginx same-origin /api reverse proxy to Uvicorn bound 127.0.0.1 only. Document HTTPS setup before exposing credentials or customer data. Keep firewall port 80/443 closed until TLS and auth verified. Systemd service, env file outside repo with restricted permissions, non-root app service user, backup and restore docs.
6. Unit/integration tests for auth, access control, CRUD, conflict, schema, migration, and existing frontend tests. Small memory footprint, no Docker.
7. Provide deployment instructions with short, verifiable steps; never include production passwords or personal data in repository.

IMPORTANT: This is a specification only, not implemented code. Review architecture and scope before coding. Work on feature/two-user-sync, not main; no production deployment until reviewed.

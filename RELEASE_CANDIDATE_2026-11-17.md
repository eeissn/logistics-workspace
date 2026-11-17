# Sputnik Workspace — release candidate 17.11.2026

Status: **RC, not yet deployed to VPS**. The installed VPS commit SHA, database backup freshness and device acceptance still require an authenticated production check. No GitHub Release tag exists for the prior production version; do not assume `main` matches the running instance.

## Included
- P0: authenticated per-order ETRN PATCH; atomically update only ETRN of the authorized owner, preserve other orders, reject stale stamps and unsupported payload, sync snapshot to client. PR #25.
- Mass ETRN: prefill from agreement number, preserve existing override, allow per-order overrides and preview/confirm (PR #22 ancestry).
- UI: manual refresh button, corrected command menu and typography, iPhone search and bottom navigation.
- Approved 10 UX improvements: quick detail panel, separate trip/ETRN steps, month comparisons, contextual commands, local PDF preview (not persisted), settings and graphite theme, saved views, margin warnings, iPhone per-record actions.
- Preserve customer/carrier PDF import, passport issue date / trailer, 2-account isolation, backups, margin calculations and Excel workflows from the integration ancestry.

## Not included
- Automatic original PDF attachment storage or links (server storage/backup design pending).
- Real payment received flags or automatic unpaid view.
- VPS rollout, data migration or physical iPhone/Windows acceptance.

## Release gate
1. Confirm full GitHub Actions on **this branch's final SHA**.
2. SSH verify active SHA, state of nginx and systemd, SQLite schema, backup freshness, and no dirty working tree or unexpected server edits.
3. Stop API, make fresh verified backup and preserve current build and environment; see deploy/README.md.
4. Build this exact SHA separately with VITE_DEMO=false; deploy only after review of observed production differences and rollback plan.
5. After service restart run `bash deploy/check-release.sh`, verify logged-in ETRN saving and persistence for one approved test entry and two-account isolation; inspect mobile Safari and Windows Zen.
6. Record deployed SHA, date, CI, rollback SHA, and results. Roll back on unsuccessful checks.

No live records were modified in preparing this candidate.

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

## Visual polish amendment — 17.11.2026

Follow-up to PR #27: visually consistent typography, desktop sidebar legibility, predictable primary CTA, low-noise search/filters, neutral KPI surfaces, comfortable record density, ETRN badge and drawer hierarchy, safe mobile touch targets and keyboard focus. Apple HIG, Attio and Linear informed the interaction principles; this is not a clone or an official endorsement.

The final release must pass the exact-SHA full Chromium + WebKit run (including per-order ETRN reload and persistent desktop navigation), API/SQLite isolation, screenshot review at desktop/mobile widths, and an explicit VPS SHA and current-backup verification. No database schema changes are part of visual polish.

After deployment, test the real number 7372 ETRN **without rewriting a real status unless authorized**. Use a permitted test entry for create/save/reload first. Verify that account A/B data are still isolated; the prior 527 count is the sum across owner partitions, not the owner's UI count.

Rollback: preserve the running SHA and `dist` before any switch; do not automatically restore an older SQLite backup over newer data.

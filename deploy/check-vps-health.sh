#!/usr/bin/env bash
# Read-only VPS release health check. Works from any current working directory.
# This only confirms publication to the VPS outbox, NOT delivery to home Windows.
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$project_root"

printf 'Workspace checkout: %s\n' "$project_root"
printf 'Installed checkout HEAD: '
git rev-parse --short HEAD

# Catch accidental local edits before diagnosing the deployed build.
if [[ -n "$(git status --porcelain)" ]]; then
    printf 'WARNING: checkout contains uncommitted changes. Review before a release.\n' >&2
fi

printf 'Checking application and nginx services...\n'
systemctl is-active --quiet logistics-workspace
systemctl is-active --quiet nginx
printf 'Services: logistics-workspace=active, nginx=active\n'

printf 'Checking HTTPS, protected API and PDF worker MIME...\n'
RELEASE_RESOLVE_IP="${RELEASE_RESOLVE_IP:-127.0.0.1}" bash "$project_root/deploy/check-release.sh"

printf 'Checking published encrypted backup (not Windows delivery)...\n'
python_bin=${RELEASE_HEALTH_PYTHON:-/opt/logistics-workspace/backend-venv/bin/python}
outbox=${RELEASE_HEALTH_OUTBOX:-/srv/logistics-backup/outbox}
if [[ ! -x "$python_bin" ]]; then
    printf 'Missing backup verification Python: %s\n' "$python_bin" >&2
    exit 1
fi
sudo -u logistics "$python_bin" -m deploy.check_backup_outbox "$outbox" --max-age-hours 36

printf 'RELEASE HEALTH OK (VPS only; Windows download NOT verified)\n'

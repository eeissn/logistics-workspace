#!/usr/bin/env bash
# Synthetic Git checkout/rollback: keep code readable and secrets private.
set -euo pipefail
base=$(cd "${TMPDIR:-/tmp}" && pwd -P)
root=$(mktemp -d "$base/sputnik-git-modes.XXXXXX")
case "$root" in "$base"/sputnik-git-modes.*) ;; *) exit 1 ;; esac
trap 'rm -rf -- "$root"' EXIT
umask 077
git init -q "$root/repo"
cd "$root/repo"
git config user.name 'Synthetic test'
git config user.email 'synthetic@example.test'
printf 'old\n' > app.py
git add app.py
git commit -qm old
old=$(git rev-parse HEAD)
printf 'new\n' > app.py
git commit -qam new
new=$(git rev-parse HEAD)
git checkout -q --detach "$old"
[[ $(stat -c '%a' app.py) == 600 ]]
# Same scoped umask used by the real root -> admin run_git wrapper.
run_git() { ( umask 022; git "$@"; ); }
run_git checkout -q --detach "$new"
[[ $(stat -c '%a' app.py) == 644 ]]
run_git checkout -q --detach "$old"
[[ $(stat -c '%a' app.py) == 644 ]]
touch synthetic-secret
[[ $(stat -c '%a' synthetic-secret) == 600 ]]
echo 'Release/rollback code mode 0644; surrounding secret mode 0600: OK'

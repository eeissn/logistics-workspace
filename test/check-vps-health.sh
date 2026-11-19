#!/usr/bin/env bash
set -euo pipefail

root=$(mktemp -d)
trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root/project/deploy" "$root/bin" "$root/unrelated"
cp "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/deploy/check-vps-health.sh" "$root/project/deploy/"

cat > "$root/project/deploy/check-release.sh" <<'MOCK'
#!/usr/bin/env bash
[[ "${RELEASE_RESOLVE_IP:-}" == "127.0.0.1" ]]
[[ "${FAIL_HTTP:-0}" != "1" ]]
MOCK

cat > "$root/bin/git" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  rev-parse) echo 123abcd ;;
  status) ;;
  *) exit 2 ;;
esac
MOCK

cat > "$root/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == is-active && "$2" == --quiet ]] || exit 2
[[ "${FAIL_SERVICE:-}" != "$3" ]]
MOCK

cat > "$root/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == -u && "$2" == logistics && "$4" == -m &&
   "$5" == deploy.check_backup_outbox &&
   "$7" == --max-age-hours && "$8" == 36 ]] || exit 2
[[ "${FAIL_OUTBOX:-0}" != 1 ]]
MOCK
chmod +x "$root/bin/"* "$root/project/deploy/"*.sh
export PATH="$root/bin:$PATH"
export RELEASE_HEALTH_PYTHON=/bin/true
export RELEASE_HEALTH_OUTBOX="$root/mock-outbox"
cd "$root/unrelated"

bash "$root/project/deploy/check-vps-health.sh" > "$root/ok.log"
grep -q 'Installed checkout HEAD: 123abcd' "$root/ok.log"
grep -q 'RELEASE HEALTH OK (VPS only; Windows download NOT verified)' "$root/ok.log"

for kind in service http outbox; do
  case "$kind" in
    service) export FAIL_SERVICE=nginx ;;
    http) unset FAIL_SERVICE; export FAIL_HTTP=1 ;;
    outbox) unset FAIL_HTTP; export FAIL_OUTBOX=1 ;;
  esac
  if bash "$root/project/deploy/check-vps-health.sh" > "$root/failure.log" 2>&1; then
    printf 'Health check wrongly accepted %s failure\n' "$kind" >&2
    exit 1
  fi
  if grep -q 'RELEASE HEALTH OK' "$root/failure.log"; then
    printf 'Health check printed false success after %s failure\n' "$kind" >&2
    exit 1
  fi
done
echo 'cwd-independent VPS release health and fail-closed tests passed'

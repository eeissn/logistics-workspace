#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/bin"

cat > "$temp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do url=$arg; done
case "$url" in
  */api/records)
    count=$(cat "$TEST_COUNTER")
    count=$((count + 1))
    printf '%s' "$count" > "$TEST_COUNTER"
    if (( count < 3 )); then printf '502'; else printf '401'; fi
    ;;
  *) printf '200' ;;
esac
SH
cat > "$temp/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$temp/bin/curl" "$temp/bin/sleep"

printf '0' > "$temp/counter"
export TEST_COUNTER="$temp/counter"
PATH="$temp/bin:$PATH" bash "$repo_root/deploy/check-release.sh" https://example.test
test "$(cat "$temp/counter")" = 3

# A persistent 502 must never be mistaken for a healthy API.
sed -i "s/if (( count < 3 ))/if (( count < 100 ))/" "$temp/bin/curl"
printf '0' > "$temp/counter"
if PATH="$temp/bin:$PATH" bash "$repo_root/deploy/check-release.sh" https://example.test; then
    echo 'Expected failure when API keeps returning HTTP 502' >&2
    exit 1
fi
test "$(cat "$temp/counter")" = 30
echo 'Release readiness retry tests passed'

#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/bin" "$temp/dist/assets"
printf '' > "$temp/dist/assets/pdf.worker-test.mjs"
export RELEASE_DIST_DIR="$temp/dist"
export TEST_WORKER_RESPONSE='200 application/javascript'
export TEST_API_FAIL_UNTIL=3
export TEST_COUNTER="$temp/counter"

cat > "$temp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do url=$arg; done
case "$url" in
  */api/records)
    count=$(cat "$TEST_COUNTER")
    count=$((count + 1))
    printf '%s' "$count" > "$TEST_COUNTER"
    if (( count < TEST_API_FAIL_UNTIL )); then printf '502'; else printf '401'; fi
    ;;
  */assets/pdf.worker*.mjs) printf '%s' "$TEST_WORKER_RESPONSE" ;;
  *) printf '200' ;;
esac
SH
cat > "$temp/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$temp/bin/curl" "$temp/bin/sleep"

run_check() {
    PATH="$temp/bin:$PATH" bash "$repo_root/deploy/check-release.sh" https://example.test
}

expect_failure() {
    if run_check; then
        echo "Expected the release check to fail: $1" >&2
        exit 1
    fi
}

printf '0' > "$TEST_COUNTER"
run_check
test "$(cat "$TEST_COUNTER")" = 3

# A persistent 502 must never be mistaken for a healthy API.
export TEST_API_FAIL_UNTIL=100
printf '0' > "$TEST_COUNTER"
expect_failure 'persistent API 502'
test "$(cat "$TEST_COUNTER")" = 30

# The worker request must not silently accept Nginx's HTML SPA fallback.
export TEST_API_FAIL_UNTIL=1
export TEST_WORKER_RESPONSE='200 text/html'
printf '0' > "$TEST_COUNTER"
expect_failure 'worker served as HTML'

export TEST_WORKER_RESPONSE='404 text/html'
expect_failure 'missing worker on server'

export TEST_WORKER_RESPONSE='200 text/javascript'
run_check

# The local artifact is required; detecting a missing worker before a release
# prevents an unrelated 200 HTML fallback from hiding broken PDF imports.
rm "$temp/dist/assets/pdf.worker-test.mjs"
expect_failure 'missing worker artifact'

touch "$temp/dist/assets/pdf.worker-first.mjs" "$temp/dist/assets/pdf.worker-second.mjs"
expect_failure 'ambiguous worker artifacts'

echo 'Release readiness and PDF worker MIME tests passed'

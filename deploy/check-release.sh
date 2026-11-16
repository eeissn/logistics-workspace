#!/usr/bin/env bash
set -euo pipefail

origin=${1:-https://logistics-sputnik.duckdns.org}
origin=${origin%/}

# The API can briefly return 502 while Uvicorn starts after a release.
# Retry boundedly; do not accept a 200 or a login redirect in place of 401.
check_status() {
    local path=$1 expected=$2 attempts=${3:-1} status attempt
    for ((attempt=1; attempt<=attempts; attempt++)); do
        status=$(curl --silent --show-error --max-time 5 --proto '=https' \
            --output /dev/null --write-out '%{http_code}' "${origin}${path}") || status=000
        if [[ "$status" == "$expected" ]]; then
            printf '%s: HTTP %s (expected %s)\n' "$path" "$status" "$expected"
            return 0
        fi
        if (( attempt < attempts )); then
            sleep 2
        fi
    done
    printf '%s: HTTP %s (expected %s) after %s attempt(s)\n' "$path" "$status" "$expected" "$attempts" >&2
    return 1
}

check_status / 200 3
check_status /api/records 401 30

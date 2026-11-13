#!/usr/bin/env bash
set -euo pipefail

origin=${1:-https://logistics-sputnik.duckdns.org}
origin=${origin%/}

check_status() {
    local path=$1 expected=$2 status
    status=$(curl --silent --show-error --max-time 15 --proto '=https' \
        --output /dev/null --write-out '%{http_code}' "${origin}${path}")
    printf '%s: HTTP %s (expected %s)\n' "$path" "$status" "$expected"
    [[ "$status" == "$expected" ]]
}

check_status / 200
check_status /api/records 401

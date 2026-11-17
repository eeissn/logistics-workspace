#!/usr/bin/env bash
set -euo pipefail

origin=${1:-https://logistics-sputnik.duckdns.org}
origin=${origin%/}

# Optional local HTTPS check via nginx: bypass VPS DNS, but retain the
# production hostname for TLS certificate verification and nginx routing.
# Example: RELEASE_RESOLVE_IP=127.0.0.1 bash deploy/check-release.sh
curl_flags=(--silent --show-error --max-time 10 --noproxy '*' --proto '=https')
if [[ -n "${RELEASE_RESOLVE_IP:-}" ]]; then
    if [[ ! "${RELEASE_RESOLVE_IP}" =~ ^[0-9A-Fa-f:.]+$ ]]; then
        printf 'Invalid RELEASE_RESOLVE_IP (numeric IP required)\n' >&2
        exit 2
    fi
    host=${origin#https://}
    host=${host%%/*}
    if [[ "$host" == *:* ]]; then
        printf 'RELEASE_RESOLVE_IP supports default HTTPS port only\n' >&2
        exit 2
    fi
    curl_flags+=(--resolve "${host}:443:${RELEASE_RESOLVE_IP}")
fi

# The API can briefly return 502 while Uvicorn starts after a release.
# Retry boundedly; do not accept a 200 or a login redirect in place of 401.
check_status() {
    local path=$1 expected=$2 attempts=${3:-1} status attempt
    for ((attempt=1; attempt<=attempts; attempt++)); do
        status=$(curl "${curl_flags[@]}" \
            --output /dev/null --write-out '%{http_code}' "${origin}${path}") || status=000
        if [[ "$status" == "$expected" ]]; then
            printf '%s: HTTP %s (expected %s)\n' "$path" "$status" "$expected"
            return 0
        fi
        if (( attempt < attempts )); then sleep 2; fi
    done
    printf '%s: HTTP %s (expected %s) after %s attempt(s)\n' "$path" "$status" "$expected" "$attempts" >&2
    return 1
}

# Vite emits a fingerprinted PDF.js worker. Nginx's SPA fallback can return
# index.html with HTTP 200 for a missing worker, so status alone is insufficient.
check_pdf_worker() {
    local dist=${RELEASE_DIST_DIR:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist"}
    local files=() name result status mime

    if [[ ! -d "$dist/assets" ]]; then
        printf 'Missing release assets directory: %s/assets\n' "$dist" >&2
        return 1
    fi
    mapfile -d '' files < <(find "$dist/assets" -maxdepth 1 -type f -name 'pdf.worker*.mjs' -print0)
    if (( ${#files[@]} != 1 )); then
        printf 'Expected exactly one built PDF worker; found %s in %s/assets\n' "${#files[@]}" "$dist" >&2
        return 1
    fi

    name=${files[0]##*/}
    result=$(curl "${curl_flags[@]}" \
        --output /dev/null --write-out '%{http_code} %{content_type}' \
        "${origin}/assets/${name}") || result='000 '
    status=${result%% *}
    mime=${result#* }
    mime=${mime%%;*}

    if [[ "$status" != 200 || ( "$mime" != 'application/javascript' && "$mime" != 'text/javascript' ) ]]; then
        printf 'PDF worker /assets/%s: HTTP %s, MIME %s (expected HTTP 200, JavaScript)\n' \
            "$name" "$status" "$mime" >&2
        return 1
    fi
    printf 'PDF worker /assets/%s: HTTP %s, MIME %s\n' "$name" "$status" "$mime"
}

check_status / 200 3
check_status /api/records 401 30
check_pdf_worker

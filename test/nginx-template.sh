#!/usr/bin/env bash
# Real nginx on an ephemeral loopback port; never reads the application database.
set -euo pipefail
command -v nginx >/dev/null || { echo 'nginx is required for this isolated test' >&2; exit 77; }
repo_root=$(cd "$(dirname "$0")/.." && pwd -P)
temp_base=$(cd "${TMPDIR:-/tmp}" && pwd -P)
sandbox_root=$(mktemp -d "$temp_base/sputnik-nginx.XXXXXX")
sandbox_root=$(cd "$sandbox_root" && pwd -P)
case "$sandbox_root" in "$temp_base"/sputnik-nginx.*) ;; *) exit 1 ;; esac
started=false
cleanup() {
    if "$started"; then nginx -e "$sandbox_root/error.log" -p "$sandbox_root/" -c "$sandbox_root/nginx.conf" -s quit || true; fi
    # Verified absolute mktemp child, containing synthetic fixtures only.
    rm -rf -- "$sandbox_root"
}
trap cleanup EXIT
mkdir -p "$sandbox_root/dist/assets" "$sandbox_root/logs"
printf '<!doctype html><title>Synthetic fixture</title>' > "$sandbox_root/dist/index.html"
printf 'export {};' > "$sandbox_root/dist/assets/pdf.worker-test.mjs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
    -keyout "$sandbox_root/test.key" -out "$sandbox_root/test.crt" >/dev/null 2>&1
python3 - "$repo_root" "$sandbox_root" <<'PY'
from pathlib import Path
import socket, sys
repo, root = map(Path, sys.argv[1:])
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
site=(repo/'deploy/nginx.conf').read_text()
site=site.replace('listen 443 ssl;', f'listen 127.0.0.1:{port} ssl;')
site=site.replace('/etc/letsencrypt/live/workspace.example.com/fullchain.pem', str(root/'test.crt'))
site=site.replace('/etc/letsencrypt/live/workspace.example.com/privkey.pem', str(root/'test.key'))
site=site.replace('/opt/logistics-workspace/logistics-workspace/dist', str(root/'dist'))
(root/'site.conf').write_text(site)
(root/'port').write_text(str(port))
# Deliberately omit global mime.types to exercise the template's worker mapping.
(root/'nginx.conf').write_text(f'pid {root}/nginx.pid;\nerror_log {root}/error.log;\nevents {{}}\nhttp {{ default_type application/octet-stream; access_log off; include {root}/site.conf; }}\n')
PY
nginx -e "$sandbox_root/error.log" -p "$sandbox_root/" -c "$sandbox_root/nginx.conf" -t
nginx -e "$sandbox_root/error.log" -p "$sandbox_root/" -c "$sandbox_root/nginx.conf"
started=true
port=$(cat "$sandbox_root/port")
url="https://workspace.example.com:$port"
code=$(curl --silent --show-error --insecure --noproxy '*' --max-time 5 \
    --resolve "workspace.example.com:$port:127.0.0.1" -D "$sandbox_root/headers" \
    -o "$sandbox_root/body" -w '%{http_code}' "$url/assets/pdf.worker-test.mjs")
[[ "$code" == 200 ]]
tr -d '\r' < "$sandbox_root/headers" | grep -Eiq '^content-type: application/javascript([;[:space:]]|$)'
[[ $(cat "$sandbox_root/body") == 'export {};' ]]
code=$(curl --silent --show-error --insecure --noproxy '*' --max-time 5 \
    --resolve "workspace.example.com:$port:127.0.0.1" -o "$sandbox_root/missing" \
    -w '%{http_code}' "$url/assets/missing.mjs")
[[ "$code" == 404 ]]
printf 'Real nginx: worker MIME and missing-module 404 passed\n'

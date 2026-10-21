#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22 is required.'; read -r -p 'Press Enter to close'; exit 1
fi
if [ ! -x vendor/browser-host/concat ] || [ ! -f web/wasm/pkg/concat_browser.js ]; then
  echo 'The original-UI browser build is not installed yet. See web/original/README.md.'
  read -r -p 'Press Enter to close'; exit 1
fi
if curl -fsS http://127.0.0.1:4317/api/health | python3 -c 'import json,sys; r=json.load(sys.stdin); sys.exit(not(r.get("ok") and r.get("ui")=="original-slint-wasm"))' 2>/dev/null; then
  open http://127.0.0.1:4317
  exit 0
fi
mkdir -p vendor/browser-host/portable
node web/original/server.mjs &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
for attempt in {1..60}; do
  if curl -fsS http://127.0.0.1:4317/api/health >/dev/null 2>&1; then
    open http://127.0.0.1:4317
    break
  fi
  sleep 1
done
wait "$server_pid"

#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 PON Cut contributors
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/web"
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 22 or newer, then open this launcher again.'
  read -r -p 'Press Enter to close…' answer
  exit 1
fi
port="${PORT:-4317}"
url="http://127.0.0.1:$port"
if curl --silent --fail --max-time 2 "$url/api/health" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.exit(JSON.parse(s).service==="pon-cut"?0:1)}catch{process.exit(1)}})'; then
  open "$url"
  exit 0
fi
node scripts/setup-engine.mjs
node server.mjs &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
for attempt in {1..30}; do
  if curl --silent --fail --max-time 1 "$url/api/health" >/dev/null; then
    open "$url"
    echo 'PON Cut is running. Keep this window open; press Ctrl+C to stop.'
    wait "$server_pid"
    exit 0
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 1
done
echo 'Could not start PON Cut. Check the error above.'
read -r -p 'Press Enter to close…' answer
exit 1

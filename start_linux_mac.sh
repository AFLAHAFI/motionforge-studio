#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Install Node.js 22.12 or newer."; exit 1; fi
if [ ! -f dist/index.html ]; then echo "Build missing. Run npm ci and npm run build."; exit 1; fi
node server.mjs --open

#!/usr/bin/env bash
# Quick launcher for the apps/bun demo.
#   ./start.sh            # dev
#   ./start.sh prod       # production
#   ./start.sh check      # boot + smoke tests
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="${HOME}/.local/bin:${PATH}"

if command -v node >/dev/null 2>&1; then
	exec node "$ROOT/scripts/start.mjs" "$@"
fi

if [ -x /usr/bin/node ]; then
	exec /usr/bin/node "$ROOT/scripts/start.mjs" "$@"
fi

echo "Node.js is required (22+). Install it from https://nodejs.org/ and re-run." >&2
exit 1

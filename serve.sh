#!/usr/bin/env bash
# ============================================================================
#  Start OpsPulse locally.
#
#  The apps are ES modules, which browsers refuse to load over file:// — so
#  they must be served over http. This just starts a static server; there is no
#  build step and nothing to install.
# ============================================================================
set -e
PORT="${1:-5500}"

cat <<EOF

  OpsPulse AI — starting a local server on port $PORT

    Live Ops Floor  (start here)   http://localhost:$PORT/demo.html
    OpsPulse alone                 http://localhost:$PORT/opspulse.html
    NorthDesk alone                http://localhost:$PORT/servicedesk.html
    Ops Copilot                    http://localhost:$PORT/app.html
    Marketing site                 http://localhost:$PORT/index.html
    Roadmap                        http://localhost:$PORT/roadmap.html

  Open several at once — they all show the same live operation.

  Press Ctrl+C to stop.

EOF

cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then exec python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then exec npx --yes serve . -l "$PORT"
else
  echo "  Neither python nor npx found. Serve this folder with any static web server." >&2
  exit 1
fi

#!/usr/bin/env bash
# ============================================================
# WorkBuddy -> MiniMax (Anthropic protocol) protocol proxy
#
# Edit MINIMAX_API_KEY below with your real key, then run:
#     ./start.sh
# Or override from your shell:
#     MINIMAX_API_KEY=sk-cp-xxx ./start.sh
# ============================================================

set -euo pipefail

# [REQUIRED] Your MiniMax Coding Plan subscription key (starts with sk-cp-).
# Either edit this line, or export MINIMAX_API_KEY in your shell before running.
: "${MINIMAX_API_KEY:=sk-cp-REPLACE_ME_WITH_YOUR_REAL_KEY}"
export MINIMAX_API_KEY

# [OPTIONAL] Local listen port, default 18000
PORT="${PORT:-18000}"

# [OPTIONAL] Log level: debug / info / warn / error
LOG_LEVEL="${LOG_LEVEL:-info}"

cat <<EOF

============================================================
  WorkBuddy + MiniMax (Anthropic) Protocol Proxy
============================================================
  MINIMAX_API_KEY = ${MINIMAX_API_KEY:0:12}...
  PORT            = ${PORT}
  LOG_LEVEL       = ${LOG_LEVEL}

  Press Ctrl+C to stop.
============================================================

EOF

# Sanity-check the key so the user sees a clear error instead of a 502 later.
if ! printf '%s' "${MINIMAX_API_KEY}" | grep -qE '^[\x20-\x7E]+$'; then
    echo "ERROR: MINIMAX_API_KEY contains non-ASCII characters. Please paste a clean key." >&2
    exit 1
fi

exec node proxy.js --port "${PORT}" --log "${LOG_LEVEL}"
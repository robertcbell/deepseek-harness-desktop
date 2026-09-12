#!/usr/bin/env bash
# DeepSeek Harness Portable Daemon
set -e

# Resolve HOME and DSH_HOME
export HOME="${HOME:-$(eval echo ~)}"
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

# Construct portable PATH including Homebrew, Bun, Node, and system paths
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

# Detect NVM if node is not found in PATH
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
    LATEST_NVM_NODE=$(find "$HOME/.nvm/versions/node" -maxdepth 2 -name bin 2>/dev/null | sort -V | tail -n 1 || true)
    if [ -n "$LATEST_NVM_NODE" ]; then
        export PATH="$LATEST_NVM_NODE:$PATH"
    fi
fi

# Load environment variables if present
if [ -f "$DSH_HOME/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$DSH_HOME/.env"
    set +a
fi

LOG_DIR="$DSH_HOME/logs"
mkdir -p "$LOG_DIR"

# Clean up stale processes listening on port 3080
PORT_PIDS=$(lsof -ti tcp:3080 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$PORT_PIDS" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Terminating stale port 3080 processes: $PORT_PIDS..."
    echo "$PORT_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Locate dsh binary
DSH_BIN=""
if command -v dsh >/dev/null 2>&1; then
    DSH_BIN="$(command -v dsh)"
elif [ -x "/opt/homebrew/bin/dsh" ]; then
    DSH_BIN="/opt/homebrew/bin/dsh"
elif [ -x "/usr/local/bin/dsh" ]; then
    DSH_BIN="/usr/local/bin/dsh"
elif [ -x "$HOME/.bun/bin/dsh" ]; then
    DSH_BIN="$HOME/.bun/bin/dsh"
fi

if [ -z "$DSH_BIN" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: 'dsh' command not found. Please install @deepseek-ai/dsh globally." >&2
    exit 1
fi

# Run invariant enforcement if available
INVARIANT_SCRIPT="$DSH_HOME/scripts/enforce_dsh_invariants.mjs"
if [ -f "$INVARIANT_SCRIPT" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Enforcing DSH Invariants..."
    if command -v bun >/dev/null 2>&1; then
        bun "$INVARIANT_SCRIPT" || true
    elif command -v node >/dev/null 2>&1; then
        node "$INVARIANT_SCRIPT" || true
    fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting DeepSeek Harness Web Server ($DSH_BIN) on http://127.0.0.1:3080..."
exec "$DSH_BIN" web --no-open --port 3080

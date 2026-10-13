#!/usr/bin/env bash
# Explicit opt-in; never installs a plugin or restarts the running service.
set -euo pipefail
if [[ $# != 1 ]]; then
  echo 'Usage: bash scripts/apply-maestro-patch.sh /path/to/installed/maestro-package' >&2
  exit 2
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node "$script_dir/apply-maestro-patch.mjs" "$1"

#!/usr/bin/env bash
# Thin wrapper — delegates to pre_tool_use.py so stdin is passed cleanly.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${HERE}/pre_tool_use.py"

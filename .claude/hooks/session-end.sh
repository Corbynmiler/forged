#!/usr/bin/env bash
# Forged session-end check.
# Reports api/ routes missing withSentry. Read-only, never blocks.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="${REPO_ROOT}/api"

if [ ! -d "$API_DIR" ]; then
  exit 0
fi

missing=()
while IFS= read -r -d '' f; do
  base="$(basename "$f")"
  # Skip non-route files
  case "$base" in
    _*) continue ;;
  esac
  if ! grep -q "withSentry" "$f" 2>/dev/null; then
    missing+=("$(basename "$f")")
  fi
done < <(find "$API_DIR" -maxdepth 1 -name "*.js" -print0)

if [ ${#missing[@]} -gt 0 ]; then
  echo ""
  echo "Forged session-end check: ${#missing[@]} api/ file(s) missing withSentry wrapper:"
  for f in "${missing[@]}"; do echo "  - api/$f"; done
  echo "Per AGENTS.md, every api/ route should wrap its handler with withSentry(handler, \"route-name\")."
fi

exit 0

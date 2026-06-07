#!/usr/bin/env bash
# Run unit tests only (fast, no Docker required).
# For the full suite including integration tests, use ./scripts/test-all.sh.
set -e
cd "$(dirname "$0")/.."
exec python3 -m pytest -m "not integration" "$@"

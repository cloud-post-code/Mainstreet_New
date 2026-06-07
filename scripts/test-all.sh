#!/usr/bin/env bash
# Run unit + integration tests. Pre-push command.
# Requires Docker running (Postgres + Stripe-mock containers).
set -e
cd "$(dirname "$0")/.."
exec python3 -m pytest "$@"
